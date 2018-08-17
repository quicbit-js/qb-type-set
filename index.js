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
var TCODES = tbase.codes_by_name()
var TCODE_NAMES = Object.keys(TCODES).reduce(function (a, n) { a[TCODES[n]] = n; return a }, [])

var FIELD_SEED = 398591981

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

// field args are [ ctx, type ] tuple
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
    constructor: Type
}

// type args are a [ tcode, values ] tuple, where values depends on the tcode
//    objects: hmap of unique fields
//    arrays: hmap of unique types
//    other types (STR, BOO, TRU, FAL...): undefined
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

module.exports = {
    // type_map: type_map,
    // field_map: field_map,
    type_set: type_set,
    field_set: field_set,
}
