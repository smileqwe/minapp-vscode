// Fixture: factory-wrap.js
// Covers: T1.1 (unknown factory wraps data/methods), T2.1.1, T2.1.2

function createMyPage(options) {
  return Page(options)
}

createMyPage({
  data: {
    userName: 'a',
    age: 18,
  },
  methods: {
    onTap() {
      console.log('tap')
    },
  },
})
