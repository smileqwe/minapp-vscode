// Fixture: 自定义 MyPage 封装（无类型包）
// Covers: 启发式探测能识别 MyPage 的配置对象

function MyPage(options) {
  return Page(options)
}

MyPage({
  data: {
    userName: 'a',
    age: 18,
  },
  methods: {
    onTap() {
      console.log('tap')
    },
    onScroll() {},
  },
  onLoad() {
    this.setData({ userName: 'b' })
  },
})

// 干扰项：普通函数调用，不应被识别为配置对象
const config = { debug: true }
setupApp(config)
