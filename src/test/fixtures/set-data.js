// Fixture: set-data.js
// Covers: T2.3.1, T2.3.2, T2.3.3, T2.3.4

Page({
  methods: {
    fetchList() {
      this.setData({ loading: true })
      const that = this
      that.setData({ foo: 1 })
      this.setData({ 'list[0].name': 'a' })

      const dynamicObj = { bar: 1 }
      this.setData(dynamicObj) // T2.3.4: should NOT be collected
    },
  },
})
