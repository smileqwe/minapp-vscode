// Fixture: Anim.Page 自定义封装（模拟 @ssv-lab/anim 框架）
// Covers:
//   - 启发式探测能识别 Anim.Page({...}) 的配置对象，并精确定位 data 里的定义
//   - computed 属性（方法简写）在 type=prop 时也能被定位（computed 结果会挂到 data）
// 关键：Anim.Page 不是白名单入口，data 里的 totalFlowerCount 是定义，
//       setData 里的 totalFlowerCount 是赋值，启发式应只返回 data 里的那个

const app = getApp()

Anim.Page({
  data: {
    totalFlowerCount: '000000000',
    provinceName: '',
  },
  computed: {
    isLogin(data) {
      return !!data.storeUser
    },
    highlightProvinceName(data) {
      if (!data.provinceName) return ''
      return data.provinceName
    },
  },
  onLoad() {
    this.setData({ pageReady: true })
  },
  getProvinceRedFlowerRanking() {
    this.setData({
      totalFlowerCount: String(0).padStart(9, '0'),
    })
  },
  _doIncrement() {
    this.setData({
      totalFlowerCount: String(1).padStart(9, '0'),
    })
  },
  updateCounter(newValue) {
    this.setData({
      totalFlowerCount: String(newValue).padStart(9, '0'),
    })
  },
})
