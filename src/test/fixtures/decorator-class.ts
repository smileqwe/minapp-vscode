// Fixture: decorator-class.ts
// Covers: T1.2 (decorator + class property), T2.2.2, T2.2.4

function page(target: any) {
  return target
}

@page
class HomePage {
  data = {
    age: 1,
    nickname: 'tom',
  }

  static foo = 1

  onTap() {
    console.log('tap')
  }
}
