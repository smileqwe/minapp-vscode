// Fixture: native-page.js
// Covers: T1.5, T3.1, T3.4

const topLevelFoo = 2 // should NOT be picked when special entry matched (T3.4)

Page({
  data: {
    foo: 1,
  },
  methods: {
    go() {
      console.log('go')
    },
  },
})
