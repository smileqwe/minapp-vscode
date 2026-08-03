// Fixture: class-extends.js
// Covers: T1.3, T2.2.1, T2.2.3

class BasePage {}

class Home extends BasePage {
  data = { x: 1 }
  #privateField = 2

  onTap() {}
  onLoad() {}
}
