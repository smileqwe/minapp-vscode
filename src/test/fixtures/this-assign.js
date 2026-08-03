// Fixture: this-assign.js
// Covers: T2.5.1, T2.5.2, T2.5.3

function Home() {}

Home.prototype.onTap = function () {}

class HomeClass {
  constructor() {
    this.userName = 'a'
    globalThis.foo = 1 // T2.5.3: should NOT be collected
  }
}
