// Software License Agreement (ISC License)
//
// Copyright (c) 2018, Matthew Voss
//
// Permission to use, copy, modify, and/or distribute this software for
// any purpose with or without fee is hereby granted, provided that the
// above copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

var tformat = require('qb-type-format')
var hmap = require('qb-hmap')
var tbase = require('qb1-type-base')
var qb1_obj2type = require('qb1-obj2type')
var TCODES = tbase.codes_by_all_names()
var TYPES_BY_CODE = tbase.types_by_code()

var tname = function (tcode, nprop) {
    var t = TYPES_BY_CODE[tcode] || err('unknown tcode: ' + tcode)
    return t[nprop || 'name']
}

var HALT = hmap.HALT
var FIELD_SEED = 398591981

var LOG_COUNT = 0
function log () {
    var args = Array.prototype.slice.call(arguments).map(function (v) { return format_arg(v) })
    args.unshift((LOG_COUNT++) + ': ')
    process.stderr.write(args.join(' ') + '\n')
    // console.log.apply(console, args)
}

function err (msg) { throw Error(msg) }
function format_arg (arg) {
    var ret = arg
    if (arg != null && typeof arg === 'object') {
        if (Array.isArray(arg)) {
            ret = '[' + arg.map(function (v) {
                return format_arg(v)
            }).join(', ') + ']'
        } else if (typeof arg.to_obj === 'function') {
            ret = JSON.stringify(tformat(arg.to_obj()))
        }
        else {
            ret = JSON.stringify(tformat(arg))
        }
    }
    if (ret.length > 200) ret = ret.slice(0, 200)
    return ret
}

// a hashed composite of type and context. (stored in Type.vals)
function Field (hash, col, ctx, type) {
    this.hash = hash            // hash (of type and ctx)
    this.col = col              // collision (in master set)
    this.ctx = ctx
    this.type = type
    this.count = 0
}

function prep_field (f) {
    return f
}

Field.prototype = {
    constructor: Field,
    to_obj: function (opt) {
        var ret = {}
        ret[this.ctx.to_obj()] = this.type.to_obj(opt)
        return ret
    }
}

// use put (ctx, type) to populate
function field_set (opt) {
    opt = opt || {}
    return hmap.set({
        hash_fn: function field_hash (args) {
            return FIELD_SEED + (0x7FFFFFFF & ((args[0].hash * 33) * args[1].hash))
        },
        equal_fn: function field_equal (field, args) {
            return field.ctx === args[0] && field.type === args[1]
        },
        put_merge_fn: function field_create (hash, col, prev, args) {
            if (prev) {
                return prev
            }
            return new Field(hash, col, args[0], args[1])
        },
        prep_fn: opt.prep_fn === undefined ? prep_field : opt.prep_fn,
    })
}

function prep_type (args) {
    var tcode = args[0]
    var vals = args[1]
    typeof tcode === 'number' || err('bad tcode')
    switch (tcode) {
        case TCODES.obj:
            validate_obj_vals(vals)
            break
        case TCODES.arr:
            validate_arr_vals(vals)
            break
    }
    return args
}

function validate_arr_vals (vals) {
    Array.isArray(vals) || err('expected array vals to be an array')
}

// todo: consider using an indexed hmap for obj.vals instead of a set of fields (hash key and val)
function validate_obj_vals (fields) {
    if (fields.length === 0) {
        return
    }
    var all_fields = fields.master
    var all_keys = all_fields.map.master

    var contexts = all_keys.hset()
    fields.for_val(function (f) {
        f.constructor === Field || err('invalid object field')
        if (contexts.get(f.ctx)) {
            err('uncombined fields for context: ' + f.ctx.toString())
        }
        contexts.put(f.ctx)
    })
}

function find_df (parent, fn, path) {
    var found = null
    switch (parent.tcode) {
        case TCODES.mul: case TCODES.arr:
            for_val(parent.vals, function (child, i) {
                path.push(i)
                if(fn(child, path) || find_df(child, fn, path)) {
                    found = true
                    return HALT
                }
                path.pop()
            })
            break
        case TCODES.obj:
            parent.vals.for_val(function (field) {
                path.push(field.ctx.toString())
                if(fn(field.type, path) || find_df(field.type, fn, path)) {
                    found = true
                    return HALT
                }
                path.pop()
            })
            break
    }
    return found ? path : null
}

function update (parent, fn, path, cache) {
    var new_p = fn(parent, path)
    if (new_p !== parent) {
        return new_p
    }

    // update children
    if (!parent.vals) {
        return parent
    }
    var new_vals = []
    var modified = false
    switch (parent.tcode) {
        case TCODES.mul: case TCODES.arr:
            for_val(parent.vals, function (child, i) {
                path.push(i)
                var new_c = update(child, fn, path, cache)
                if (new_c !== child) {
                    modified = true
                }
                if (new_c) {            // deleted for falsey return
                    new_vals.push(new_c)
                }
                path.pop()
            })
            break
        case TCODES.obj:
            for_val(parent.vals, function (field, i) {
                path.push(field.ctx.toString())
                var new_c = update(field.type, fn, path, cache)
                if (new_c !== field.type) {
                    modified = true
                }
                if (new_c) {            // is deleted for falsey return
                    new_vals.push([field.ctx, new_c])
                }
                path.pop()
            })
            break
    }
    return modified ? create_new(parent.tcode, new_vals, cache) : parent
}

function create_new(tcode, new_vals, cache) {
    var create_args
    switch (tcode) {
        case TCODES.arr:
            create_args = new_vals
            break
        case TCODES.mul:
            if (new_vals.length === 1) {
                return new_vals[0]
            }
            create_args = cache.all_types.hset()
            new_vals.forEach(function (type) { create_args.put([type])})
            break
        case TCODES.obj:
            create_args = cache.all_fields.hset()
            new_vals.forEach(function (ctx_type) {
                create_args.put(cache.all_fields.put(ctx_type))
            })
            break
    }
    return cache.all_types.put([tcode, create_args])
}

function cycle_check_type (t, seen) {
    !seen.get(t) || err('cycle detected')
    seen.set(t, 1)
    for_val(t.vals, function (c) {
        if (c.vals) {
            cycle_check_type(c, seen)
        }
    })
    seen.delete(t)
}

var TCOUNT = 0
function Type (hash, col, tcode, vals) {
    this.hash = hash            // hash (of tcode and vals)
    this.col = col              // collision (in master set)
    this.tcode = tcode
    this.vals = vals            // for object: [field], for array: [type]
    this.count = ++TCOUNT
}

Type.prototype = {
    constructor: Type,
    HALT: HALT,

    // perform depth-first search on all children of this type,
    // applying fn (t) to all children and stopping upon truthy result - returns
    // an array path to the found node or null if not found
    find_df: function (fn) {
        return find_df(this, fn, [])
    },
    remove_all: function (fn, cache) {
        return update(this, function (parent, path) {
            return fn(parent, path) ? null : parent
        }, [], cache)
    },
    is_empty: function () {
        return this.vals && this.vals.length === 0
    },
    has_cycle: function () {
        return cycle_check_type(this, new Map())
    },
    to_obj: function (opt) {
        var ret
        switch (this.tcode) {
            case TCODES.arr:
                ret = []
                for_val(this.vals, function (v) {
                    ret.push(v.to_obj(opt))
                })
                break
            case TCODES.obj:
                ret = {}
                this.vals.for_val(function (field) {
                    ret[field.ctx.toString()] = field.type.to_obj(opt)
                })
                break
            case TCODES.mul:
                var mtypes = []
                this.vals.for_val(function (v) {
                    mtypes.push(v.to_obj(opt))
                })
                ret = mtypes.length === 1 ? mtypes[0] : { $mul: mtypes }
                break
            default:
                ret = tname(this.tcode, opt && opt.name_prop)
        }
        return ret
    }
}

var TCODE_FACTOR = 2985921
var EMPTY_FACTOR = 402537

var for_val = hmap.for_val

// use put(tcode, values) to populate where values depends on tcode:
//    obj: hset of unique fields
//    arr: array of cycling types, i.e. [ n, s ] means [ n, s, n, s, ... ]
//    mul: hset of unique types
//    other (STR, BOO, TRU, FAL...): undefined
function type_set (opt) {
    opt = opt || {}
    return hmap.set(
        {
            hash_fn: function type_hash (args) {
                var h = args[0]
                switch (args[0]) {
                    case TCODES.arr:
                        h = h * TCODE_FACTOR                // create greater seed difference for object/array/other
                        if (args[1].length) {
                            for_val(args[1], function (v) {
                                h = 0x7FFFFFFF & ((h * 33) ^ v.hash)        // xor - by berstein (order matters)
                            })
                        } else {
                            h *= EMPTY_FACTOR               // distance empty sets from containers of empty sets
                        }
                        break
                    case TCODES.obj:
                    case TCODES.mul:
                        h = h * TCODE_FACTOR                // create greater seed difference for object/array/other
                        if (args[1].length) {
                            for_val(args[1], function (v) {
                                h = 0x7FFFFFFF & (h ^ v.hash)               // order agnostic
                            })
                        } else {
                            h *= EMPTY_FACTOR               // distance empty sets from containers of empty sets
                        }
                        break
                    // other type hashes are just the tcode
                }
                return h
            },
            equal_fn: function type_equal (type, args) {
                // if (type.col > 3) {
                //     // a breakpoint here is one way to inspect very large parsing jobs with collision problems
                //     console.log('collisions', type.col)
                // }
                if (type.tcode !== args[0]) {
                    return false
                }

                if (type.vals) {
                    return same_vals(type, args[1])
                }

                return true
            },
            put_merge_fn: function type_create (hash, col, prev, args) {
                if (prev) {
                    return prev
                }
                // var cycle0 = require('qb-cycle0')
                // check for uncondensed arrays
                // if (args[0] === TCODES.arr) {
                //     var cyc = cycle0.cycle0(args[1])
                //     if (cyc && args[1].length !== cyc) {
                //         err("HERE")
                //     }
                // }
                return new Type(hash, col, args[0], args[1])
            },
            // let null turn off validations
            prep_fn: opt.prep_fn === undefined ? prep_type : opt.prep_fn
        }
    )
}

function same_vals (type, vals) {
    if (type.vals.same_hashes) {
        // multi-type and objects
        return type.vals.same_hashes(vals)
    }
    else {
        // arrays
        var tvals = type.vals
        var tlen = tvals.length
        if (tlen !== vals.length) {
            return false
        }
        for (var i=0; i<tlen; i++) {
            if ( tvals[i] !== vals[i] ) {
                return false
            }
        }
    }
    return true
}

// function any_key (cache) {
//     if (!cache.ANY_KEY) {
//         cache.ANY_KEY = cache.all_keys.put_s('*')
//     }
//     return cache.ANY_KEY
// }

function any_arr (cache) {
    if (!cache.ANY_ARR) {
        var types = []
        // types.put(any_type(cache))
        cache.ANY_ARR = cache.all_types.put([TCODES.arr, types])
    }
    return cache.ANY_ARR
}

function any_obj (cache) {
    if (!cache.ANY_OBJ) {
        var fields = cache.all_fields.hset()
        // types.put(any_type(cache))
        // var fields = field_set()
        // fields.put(cache.all_fields.put(any_key(cache), any_type(cache)))
        cache.ANY_OBJ = cache.all_types.put([TCODES.obj, fields])
    }
    return cache.ANY_OBJ
}

// function any_type (cache) {
//     if (!cache.ANY_TYPE) {
//         cache.ANY_TYPE = cache.all_types.put(TCODES.any)
//     }
//     return cache.ANY_TYPE
// }

function obj2type (obj, cache) {
    var info = obj2type_info(obj, cache)
    Object.keys(info.unresolved).length === 0 || err('unresolved types: ' + JSON.stringify(info.unresolved))
    return info.root
}

function obj2type_info (obj, cache) {
    cache = cache || {}
    cache.by_name = cache.by_name || {}
    cache.all_keys = cache.all_keys || hmap.string_set()
    cache.all_types = cache.all_types || type_set()
    cache.all_fields = cache.all_fields || field_set()

    // use old-school obj2typ which to normalize names and nesting.
    var info = qb1_obj2type(obj, {
        lookupfn: function (n) {
            var ret = cache.by_name[n]
            if (!ret) {
                var tcode = TCODES[n] || err('no tcode for ' + n)
                switch (tcode) {
                    case TCODES.obj:
                        ret = any_obj(cache)
                        break
                    case TCODES.arr:
                        ret = any_arr(cache)
                        break
                    default:
                        ret = cache.all_types.put([tcode])
                }
                cache.by_name[n] = ret
            }
            return ret
        },
        createfn: function (props) {
            var ret
            switch (props.base) {
                case 'obj':
                    var fields = cache.all_fields.hset()
                    Object.keys(props.obj).forEach(function (k) {
                        var ctx = cache.all_keys.put(k)
                        var type = props.obj[k]
                        var field = cache.all_fields.put([ctx, type])
                        fields.put(field)
                    })
                    ret = cache.all_types.put([TCODES.obj, fields])
                    break
                case 'arr':
                    // I considered consolidating array values here, but that
                    // can corrupt cycles like [ n, s, n ] -> [ n, s ]... not the same
                    ret = cache.all_types.put([TCODES.arr, props.arr])
                    break
                case 'mul':
                    var mtypes = cache.all_types.hset()
                    props.mul.forEach(function (v) { mtypes.put(v) })
                    ret = cache.all_types.put([TCODES.mul, mtypes])
                    break
                default:
                    ret = cache.all_types.put([props.base])
            }
            return ret
        },
        custom_props: { $hash: 'hash', $col: 'col' },
    })
    info.cache = cache
    return info
}

module.exports = {
    // type_map: type_map,
    // field_map: field_map,
    log: log,
    obj2type: obj2type,
    obj2type_info: obj2type_info,
    type_set: type_set,
    field_set: field_set,
    HALT: HALT,
}
