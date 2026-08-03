// Fixture: composition-api.js
// Covers: T1.4, T2.4.1, T2.4.2, T2.4.3

import { ref, computed } from 'vue'

definePage(() => {
  const count = ref(0)
  const double = computed(() => count.value * 2)

  function handleTap() {
    count.value++
  }

  return {
    count,
    double,
    handleTap,
  }
})

// T2.4.3: arrow directly returning an object
const buildState = () => ({ foo: 1 })
