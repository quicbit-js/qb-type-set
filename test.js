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

var test = require('test-kit').tape()
var tset = require('.')

function err (msg) { throw Error(msg) }

function check_collisions (cache) {
    var sets = ['all_keys', 'all_types', 'all_fields']
    sets.forEach(function (s) {
        var collisions = cache[s].collisions()
        collisions.length === 0 || err('unexpected collisions in cache.' + s)
    })
}

test('obj2type', function (t) {
    t.table_assert([
        [ 'obj',                                            'exp' ],
        [ [ {$m: ['s','n']}, 'a' ],                         [ {$mul: ['str','num']}, [] ] ],
        [ [],                                               [] ],
        [ [ {x: {a:'n',b:'s'}}, {x: {a:'n',b:'s',x:'s'}} ], [ {x: {a:'num',b:'str'}}, {x: {a:'num',b:'str',x:'str'}} ] ],
        [ { a: 'n' },                                       { a: 'num' } ],
        [ { a: 's', b: ['s', 'i'] },                        { a: 'str', b: ['str', 'int'] } ],
        [ [ {a: 's'}, {a: 's'} ],                           [ {a: 'str'} ] ],
        [ [ {a: 's'}, {a: 'n'} ],                           [ {a: 'str'}, {a: 'num'} ] ],
        [ [ {a: 's', b: 'n'}, {a: 's'} ],                   [ {a: 'str', b: 'num'}, {a: 'str'} ] ],
        [ [ {a: 's', b: 'n'}, ['s'] ],                      [ {a: 'str', b: 'num'}, ['str'] ] ],
        [ [ 'n', 's', 'n' ],                                [ 'num', 'str' ] ],
        [ [ {$m: ['s','n']}, ['o'] ],                       [ {$mul: ['str','num']}, [{}] ] ],
    ], function (obj) {
        var info = tset.obj2type_info(obj)
        check_collisions (info.cache)
        return info.root.to_obj()
    } )
})

