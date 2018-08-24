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

var hmap = require('qb-hmap')
var tbase = require('qb1-type-base')
var typeobj = require('qb1-type-obj')
var TCODES = tbase.codes_by_all_names()
var TCODE_NAMES = Object.keys(TCODES).reduce(function (a, n) { a[TCODES[n]] = n; return a }, [])

var HALT = hmap.HALT
var FIELD_SEED = 398591981

function err (msg) { throw Error(msg) }

function Field (hash, col, ctx, type) {
    this.hash = hash
    this.col = col
    this.ctx = ctx
    this.type = type
    this.count = 0
}

Field.prototype = {
    constructor: Field,
    to_obj: function () {
        var ret = {}
        ret[this.ctx.to_obj()] = this.type.to_obj()
        return ret
    }
}

// use put_create (ctx, type) to populate
function field_set () {
    return hmap.set({
        hash_fn: function field_hash (args) {
            return FIELD_SEED + (0x7FFFFFFF & ((args[0].hash * 33) * args[1].hash))
        },
        equal_fn: function field_equal (field, args) {
            return field.ctx === args[0] && field.type === args[1]
        },
        create_fn: function field_create (hash, col, prev, args) {
            if (prev) {
                return prev
            }
            return new Field(hash, col, args[0], args[1])
        },
        validate_fn: function field_validate (val) {
            val.constructor === Field || err('invalid value: ' + val)
        },
    })
}

function validate_type (tcode, vals) {
    typeof tcode === 'number' || err('bad tcode')
    if (tcode === TCODES.obj) {
        validate_obj_fields(vals)
    }
}

// todo: consider using an indexed hmap for obj.vals instead of a set of fields (hash key and val)
function validate_obj_fields (fields) {
    if (fields.length === 0) {
        return
    }
    var all_fields = fields.master
    var all_keys = all_fields.map.key_set

    // var all_types = all_fields.
    var contexts = all_keys.hset()
    fields.for_val(function (f) {
        f.constructor === Field || err('invalid object field' )
        if (contexts.get(f.ctx)) {
            err('multiple for context: ' + f.ctx.toString())
        }
        contexts.put(f.ctx)
    })

}

var TCOUNT = 0

function find_df (parent, fn, path) {
    var found = null
    switch (parent.tcode) {
        case TCODES.mul:
            parent.vals.for_val(function (child, i) {
                path.push(i)
                if(fn(child) || find_df(child, fn, path)) {
                    found = true
                    return HALT
                }
                path.pop()
            })
            break
        case TCODES.arr:
            parent.vals.for_val(function (child, i) {
                path.push(i)
                if(fn(child) || find_df(child, fn, path)) {
                    found = true
                    return HALT
                }
                path.pop()
            })
            break
        case TCODES.obj:
            parent.vals.for_val(function (field) {
                path.push(field.ctx.toString())
                if(fn(field.type) || find_df(field.type, fn, path)) {
                    found = true
                    return HALT
                }
                path.pop()
            })
            break
    }
    return found ? path : null
}

function Type (hash, col, tcode, vals) {
    this.hash = hash
    this.col = col
    this.tcode = tcode
    this.vals = vals
    // validate_type(tcode, vals)
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
    is_empty: function () {
        return this.vals && this.vals.length === 0
    },
    to_obj: function () {
        var ret
        switch (this.tcode) {
            case TCODES.arr:
                ret = []
                this.vals.for_val(function (v) {
                    ret.push(v.to_obj())
                })
                break
            case TCODES.obj:
                ret = {}
                this.vals.for_val(function (field) {
                    var key = field.ctx.toString()
                    var val = field.type.to_obj()
                    // todo: consider using obj hmap instead
                    ret[key] == null || err('uncombined fields: ' + key + '  Should use a multi-type instead')
                    ret[key] = val
                })
                break
            case TCODES.mul:
                var mtypes = []
                this.vals.for_val(function (v) {
                    mtypes.push(v.to_obj())
                })
                ret = mtypes.length === 1 ? mtypes[0] : { $mul: mtypes }
                break
            default:
                ret = TCODE_NAMES[this.tcode]
        }
        return ret
    }
}

var TCODE_FACTOR = 2985921
var EMPTY_FACTOR = 402537

// use put_create(tcode, values) to populate where values depends on tcode:
//    obj: hset of unique fields
//    arr: hset of unique types
//    mul: hset of unique types
//    other (STR, BOO, TRU, FAL...): undefined
function type_set () {
    return hmap.set(
        {
            hash_fn: function type_hash (args) {
                var h = args[0]
                switch (args[0]) {
                    case TCODES.obj:
                    case TCODES.arr:
                    case TCODES.mul:
                        h = h * TCODE_FACTOR          // create greater seed difference for object/array/other
                        if (args[1].length) {
                            args[1].for_val(function (v) {
                                h = 0x7FFFFFFF & (h ^ v.hash)
                            })
                        } else {
                            h *= EMPTY_FACTOR       // distance empty sets from containers of empty sets
                        }
                        break
                    // other type hashes are just the tcode
                }
                return h
            },
            equal_fn: function type_equal (type, args) {
                if (type.tcode !== args[0]) {
                    return false
                }

                if (type.vals) {
                    return type.vals.same_hashes(args[1])
                }

                return true
            },
            create_fn: function type_create (hash, col, prev, args) {
                if (prev) {
                    return prev
                }
                return new Type(hash, col, args[0], args[1])
            }
        }
    )
}

function any_key (cache) {
    if (!cache.ANY_KEY) {
        cache.ANY_KEY = cache.all_keys.put_s('*')
    }
    return cache.ANY_KEY
}

function any_arr (cache) {
    if (!cache.ANY_ARR) {
        var types = cache.all_types.hset()
        // types.put(any_type(cache))
        cache.ANY_ARR = cache.all_types.put_create(TCODES.arr, types)
    }
    return cache.ANY_ARR
}

function any_obj (cache) {
    if (!cache.ANY_OBJ) {
        var fields = cache.all_fields.hset()
        // types.put(any_type(cache))
        // var fields = field_set()
        // fields.put(cache.all_fields.put_create(any_key(cache), any_type(cache)))
        cache.ANY_OBJ = cache.all_types.put_create(TCODES.obj, fields)
    }
    return cache.ANY_OBJ
}

function any_type (cache) {
    if (!cache.ANY_TYPE) {
        cache.ANY_TYPE = cache.all_types.put_create(TCODES.any)
    }
    return cache.ANY_TYPE
}

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

    var custom_props = { $hash: 'hash', $col: 'col' }

    var info = typeobj.obj2typ(obj, {
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
                        ret = cache.all_types.put_create(tcode)

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
                        var ctx = cache.all_keys.put_create(k)
                        var type = props.obj[k]
                        var field = cache.all_fields.put_create(ctx, type)
                        fields.put(field)
                    })
                    ret = cache.all_types.put_create(TCODES.obj, fields)
                    break
                case 'arr':
                    var arrtypes = cache.all_types.hset()
                    props.arr.forEach(function (v) { arrtypes.put(v) })
                    ret = cache.all_types.put_create(TCODES.arr, arrtypes)
                    break
                case 'mul':
                    var mtypes = cache.all_types.hset()
                    props.mul.forEach(function (v) { mtypes.put(v) })
                    ret = cache.all_types.put_create(TCODES.mul, mtypes)
                    break
                default:
                    ret = cache.all_types.put_create(props.base)
            }
            return ret
        },
        custom_props: custom_props,
    })
    info.cache = cache
    return info
}

module.exports = {
    // type_map: type_map,
    // field_map: field_map,
    obj2type: obj2type,
    obj2type_info: obj2type_info,
    type_set: type_set,
    field_set: field_set,
    HALT: HALT,
}
