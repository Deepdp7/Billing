// better-sqlite3-multiple-ciphers ships typings its package "exports" map does not expose to NodeNext resolution.
// Its API is better-sqlite3's (plus the key/rekey pragmas), so reuse those types.
declare module 'better-sqlite3-multiple-ciphers' {
  import Database = require('better-sqlite3');
  export = Database;
}
