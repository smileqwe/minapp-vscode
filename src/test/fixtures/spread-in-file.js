// Fixture: spread-in-file.js
// Covers: T2.6.1, T2.6.2

const base = { foo: 1 }
const mixinA = { bar: 1 }

Page({
  data: Object.assign({}, mixinA, {
    ...base,
    localProp: 'x',
  }),
})
