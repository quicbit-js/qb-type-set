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

var FIELD_SEED = 398591981

function err (msg) { throw Error(msg) }

function Str (hash, col, s) {
    this.hash = hash
    this.col = col
    this.s = s
}

Str.prototype = {
    constructor: Str,
    to_obj: function () { return this.s },
    toString: function () { return this.s },
}

function string_set () {
    return hmap.key_set(
        function str_hash (args) {
            var s = args[0]
            var h = 0
            for (var i=0; i < s.length; i++) {
                h = 0x7FFFFFFF & ((h * 33) ^ s[i])
            }
            return h
        },
        function str_equal (sobj, args) {
            return sobj.s === args[0]
        },
        function str_create (hash, col, prev, args) {
            if (prev) { return prev }
            return new Str(hash, col, args[0])
        }
    )
}

function Field (hash, col, ctx, type) {
    this.hash = hash
    this.col = col
    this.ctx = ctx
    this.type = type
    this.count = 0
}

Field.prototype = {
    constructor: Field
}

// use put_create (ctx, type) to populate
function field_set () {
    return hmap.key_set(
        function field_hash (args) {
            return FIELD_SEED + (0x7FFFFFFF & ((args[0].hash * 33) * args[1].hash))
        },
        function field_equal (field, args) {
            return field.ctx === args[0] && field.type === args[1]
        },
        function field_create (hash, col, prev, args) {
            if (prev) {
                return prev
            }
            return new Field(hash, col, args[0], args[1])
        }
    )
}

var TCODE_FACTOR = 2985923
var TCOUNT = 0

function Type (hash, col, tcode, vals) {
    this.hash = hash
    this.col = col
    this.tcode = tcode
    this.vals = vals
    this.count = ++TCOUNT
}

Type.prototype = {
    constructor: Type,
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
                    ret[field.ctx.toString()] = field.type.to_obj()
                    // ret[field.ctx.toString() + '(' + field.count + ')'] = type2obj(field.type)
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

// use put_create(tcode, values) to populate where values depends on tcode:
//    obj: hset of unique fields
//    arr: hset of unique types
//    mul: hset of unique types
//    other (STR, BOO, TRU, FAL...): undefined
function type_set () {
    return hmap.key_set(
        function type_hash (args) {
            var h = args[0]
            switch (args[0]) {
                case TCODES.obj:
                case TCODES.arr:
                case TCODES.mul:
                    h = h * TCODE_FACTOR          // create greater seed difference for object/array/other
                    args[1].for_val(function (v) {
                        h = 0x7FFFFFFF & (h ^ v.hash)
                    })
                    break
                // other type hashes are just the tcode
            }
            return h
        },
        function type_equal (type, args) {
            if (type.tcode !== args[0]) {
                return false
            }

            if (type.vals) {
                return type.vals.same_hashes(args[1])
            }

            return true
        },
        function type_create (hash, col, prev, args) {
            if (prev) {
                return prev
            }
            return new Type(hash, col, args[0], args[1])
        }
    )
}

function obj2type (obj, cache) {
    cache = cache || {}
    cache.by_name = cache.by_name || {}
    cache.all_keys = cache.all_keys || string_set()
    cache.all_types = cache.all_types || type_set()
    cache.all_fields = cache.all_fields || field_set()

    var custom_props = { $hash: 'hash', $col: 'col' }

    var info = typeobj.obj2typ(obj, {
        lookupfn: function (n) {
            var ret = cache.by_name[n]
            if (!ret) {
                var tcode = TCODES[n] || err('no tcode for ' + n)
                ret = cache.by_name[n] = cache.all_types.put_create(tcode)
            }
            return ret
        },
        createfn: function (props) {
            var ret
            switch (props.base) {
                case 'obj':
                    var fields = field_set()
                    Object.keys(props.obj).forEach(function (k) {
                        var ctx = cache.all_keys.put_create(k)
                        var type = props.obj[k]
                        var field = cache.all_fields.put_create(ctx, type)
                        fields.put(field)
                    })
                    ret = cache.all_types.put_create(TCODES.obj, fields)
                    break
                case 'arr':
                    var arrtypes = type_set()
                    Object.keys(props.arr).forEach(function (k) { arrtypes.put(props.arr[k]) })
                    ret = cache.all_types.put_create(TCODES.arr, arrtypes)
                    break
                case 'mul':
                    var mtypes = type_set()
                    Object.keys(props.obj).forEach(function (k) { mtypes.put(props.arr[k]) })
                    ret = cache.all_types.put_create(TCODES.arr, mtypes)
                    break
                default:
                    ret = cache.all_types.put_create(props.base)
            }
            return ret
        },
        custom_props: custom_props,
    })
    var ret = info.root.to_obj()
    return ret
}

module.exports = {
    // type_map: type_map,
    // field_map: field_map,
    obj2type: obj2type,
    type_set: type_set,
    field_set: field_set,
}
