# qb-type-set

High performance sets of quicbit types (backed by [qb-hmap](https://github.com/quicbit-js/qb-hmap)).

qb-type-set optimizes for fast hash/store/fetch of complex types: objects, arrays, and multi-types.  By
storing types in a common master set, type equivalence can be checked using '==='.  Hashing of
simple types uses a fixed lower range and hasing of complex types leverages existing type hashes
and fields, and so is quick as well.
