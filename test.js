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

test('obj2type', function (t) {
    t.table_assert([
        [ 'obj',                          'exp' ],
        [ { a: 'n' },                     { a: 'num' } ],
        [ { a: 's', b: ['s', 'i'] },      { a: 'str', b: ['str', 'int'] } ],
        [ [ {a: 's'}, {a: 's'} ],         [ {a: 'str'} ] ],
        [ [ {a: 's'}, {a: 'n'} ],         [ {a: 'str'}, {a: 'num'} ] ],
        [ [ {a: 's', b: 'n'}, {a: 's'} ], [ {a: 'str', b: 'num'}, {a: 'str'} ] ],
        [ [ {a: 's', b: 'n'}, ['s'] ],      [ {a: 'str', b: 'num'}, ['str'] ] ],
        [ [ 'n', 's', 'n' ],              [ 'num', 'str' ] ],
        [ [{ $m: ['s', 'n']}, 'a'],        [ { $mul: [ 'str', 'num' ] }, [ '*' ] ] ],
        [ [{ $m: ['s', 'n']}, ['o']],      [ { $mul: [ 'str', 'num' ] }, [ { '*': '*' } ] ] ],
    ], function (obj) {
        var type = tset.obj2type(obj)
        return type.to_obj()
    } )
})

