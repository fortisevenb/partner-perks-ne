import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { parse } from 'jsonc-parser'
import {
  getAuth,
  grantAllCoupons,
  getSuperCoupons
} from './index.ts'

const passportPath = resolve(import.meta.dirname, './passport.jsonc')
const authPath = resolve(import.meta.dirname, './auth.json')

/**
 * 格式化为标准北京时间字符串 (YYYY/MM/DD HH:mm:ss.SSS)
 * 无论系统处于什么时区，都精准显示北京时间 (UTC+8)
 */
export function formatBeijingTime(timestamp: number): string {
  const d = new Date(timestamp + 8 * 3600 * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  const min = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0')
  return `${y}/${m}/${day} ${h}:${min}:${s}.${ms}`
}

/**
 * 步骤 1：通过 passport.jsonc 中的 NTES_YD_PASSPORT 获取并缓存 auth.json
 */
export async function getAuthByPassports() {
  if (!existsSync(passportPath)) {
    console.error('❌ 未找到 passport.jsonc 文件！')
    return []
  }

  const jsonStr = readFileSync(passportPath, 'utf-8')
  const passportList: string[] = parse(jsonStr) || []

  if (passportList.length === 0) {
    console.warn('⚠️ passport.jsonc 中暂无 Cookie 内容，请先填入 NTES_YD_PASSPORT 后再运行！')
    return []
  }

  console.log(`[${formatBeijingTime(getBeijingNow())}] 正在获取 ${passportList.length} 个账号的 Auth Token...`)

  const resp = await Promise.allSettled(
    passportList.map((psport) => getAuth(psport))
  )

  const authList = resp.map((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`✅ 账号 ${i + 1} 认证成功 (UID: ${r.value.glUid})`)
      return r.value
    } else {
      console.error(`❌ 账号 ${i + 1} 认证失败:`, r.reason)
      return null
    }
  }).filter(Boolean)

  writeFileSync(authPath, JSON.stringify(authList, null, 2), 'utf-8')
  console.log(`[${formatBeijingTime(getBeijingNow())}] 认证信息已保存至 auth.json (成功: ${authList.length} 个)`)
  return authList
}

/**
 * 查询当前可领取的券列表
 */
export async function listCoupons() {
  if (!existsSync(authPath)) {
    console.log('未找到缓存的 auth.json，正在重新获取认证...')
    await getAuthByPassports()
  }

  if (!existsSync(authPath)) return

  const authList = JSON.parse(readFileSync(authPath, 'utf-8'))
  if (!authList || authList.length === 0) {
    console.log('当前没有有效的账号认证信息。')
    return
  }

  console.log('\n===== 查询当前可抢优惠券列表 =====')
  const coupons = await getSuperCoupons(authList[0])
  if (coupons.length === 0) {
    console.log('未查询到优惠券或当前暂无活动。')
    return
  }

  coupons.forEach((c: any, index: number) => {
    console.log(`${index + 1}. [${c.brandName}] ${c.couponName} (类型: ${c.couponType}, ID: ${c.couponId})`)
  })
  console.log('====================================\n')
}

/**
 * 步骤 2：直接开始抢券（单轮并发）
 */
export async function grantCouponsByAuths(roundIndex = 1) {
  if (!existsSync(authPath)) {
    console.log('未找到 auth.json，尝试自动生成...')
    const auths = await getAuthByPassports()
    if (!auths || auths.length === 0) return
  }

  const jsonStr = readFileSync(authPath, 'utf-8')
  const authList: any[] = JSON.parse(jsonStr) || []

  if (authList.length === 0) {
    console.warn('⚠️ auth.json 中没有有效凭据，请重新刷新认证凭据！')
    return
  }

  console.log(`[${formatBeijingTime(getBeijingNow())}] 🚀 第 ${roundIndex} 波发射！请求全速打出（共 ${authList.length} 个账号）...`)

  const logs: any[] = []
  await Promise.allSettled(
    authList.map((auth, index) => {
      // 默认抢直充到手机的外卖券 PHONE_REWARD 和兑换码 CODE
      return grantAllCoupons(auth, ['PHONE_REWARD', 'CODE']).then((couponRespList) => {
        const success = couponRespList?.filter((c: any) => c?.value?.code === 200)
        const fail = couponRespList?.filter((c: any) => c?.value?.code !== 200)
        logs.push({
          index,
          success,
          fail,
          raw: couponRespList,
          text: `<===== 账号 ${index + 1} 结果 =====>\n尝试: ${couponRespList?.length}, 成功: ${success.length}, 失败: ${fail.length}`,
        })
      })
    })
  )

  logs.sort((a, b) => a?.index - b?.index)
  logs.forEach(({ raw, text }) => {
    console.log(text)
    raw?.forEach((e: any) => {
      const { code, msg, coupon = {}, ...extra } = e?.value || {}
      console.log(`- [${coupon?.brandName || '未知'}] ${coupon?.couponName || '未知券'}: 状态码 ${code} (${msg || '成功'})`)
    })
  })
}

/**
 * 获取标准北京时间（毫秒级对齐，多源冗余校准）
 */
let beijingOffsetMs = 0

export async function syncBeijingTime(): Promise<number> {
  const sources = [
    {
      name: '苏宁授时源',
      url: 'https://f.m.suning.com/api/ct.do',
      parse: (text: string) => JSON.parse(text).currentTime as number
    },
    {
      name: '淘宝授时源',
      url: 'https://acs.m.taobao.com/gw/mtop.common.getTimestamp/',
      parse: (text: string) => parseInt(JSON.parse(text).data.t, 10)
    }
  ]

  const offsets: number[] = []

  for (const src of sources) {
    try {
      const t0 = Date.now()
      const res = await fetch(src.url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(2000)
      })
      const text = await res.text()
      const t1 = Date.now()
      const rtt = t1 - t0
      const serverTime = src.parse(text)
      const estimatedBeijing = serverTime + rtt / 2
      const offset = estimatedBeijing - t1
      offsets.push(offset)
      console.log(`📡 [时间对齐] ${src.name} RTT: ${rtt}ms, 本地时钟偏差: ${offset > 0 ? '+' : ''}${offset.toFixed(1)}ms`)
    } catch {
      // 容错
    }
  }

  if (offsets.length > 0) {
    beijingOffsetMs = offsets.reduce((a, b) => a + b, 0) / offsets.length
    console.log(`🎯 [校准成功] 当前系统时钟修正量: ${beijingOffsetMs > 0 ? '+' : ''}${beijingOffsetMs.toFixed(1)}ms\n`)
  } else {
    console.warn(`⚠️ 无法连接外部北京时间授时接口，将使用本机系统时间。`)
  }

  return beijingOffsetMs
}

export function getBeijingNow(): number {
  return Date.now() + beijingOffsetMs
}

/**
 * 步骤 3：超高精度定时 00:00:00 狙击抢券
 * - 基于毫秒时间戳严格对齐北京时间 00:00:00.000
 * - 不依赖操作系统的本地时区设置
 */
export async function scheduleMidnight(advanceMs = 80) {
  console.log('\n========================================================')
  console.log('         ⏰ 极速高精度 00:00:00 准点狙击模式已启动')
  console.log('========================================================')

  // 1. 同步北京时间
  await syncBeijingTime()

  // 2. 预热账号认证信息
  console.log(`[${formatBeijingTime(getBeijingNow())}] 正在预热账号认证信息...`)
  const auths = await getAuthByPassports()
  if (!auths || auths.length === 0) {
    console.error('❌ 预热失败：请先在 passport.jsonc 中填入有效的 NTES_YD_PASSPORT！')
    return
  }

  // 3. 计算基于北京时间的下一个精确 00:00:00.000 时间戳
  // 北京时间处于 UTC+8（偏移 28,800,000 毫秒）
  // 每天为 86,400,000 毫秒
  const curBeijingTs = getBeijingNow()
  const BJ_OFFSET = 8 * 3600 * 1000
  const ONE_DAY = 24 * 3600 * 1000

  // 当前北京时间当天已经过去的毫秒数
  const passedTodayMs = (curBeijingTs + BJ_OFFSET) % ONE_DAY
  // 距离下一个北京时间 00:00:00.000 的剩余毫秒数
  const remainToMidnightMs = ONE_DAY - passedTodayMs
  // 下一个北京时间 00:00:00.000 的精确时间戳
  const targetMidnightTs = curBeijingTs + remainToMidnightMs
  // 扣除提前发射量（例如提前 80ms 抵消网络延迟）
  const wave1Target = targetMidnightTs - advanceMs

  console.log(`当前北京时间: ${formatBeijingTime(curBeijingTs)}`)
  console.log(`目标北京时间: ${formatBeijingTime(targetMidnightTs)} (下一个 00:00:00 整点)`)
  console.log(`第 1 波提前量: ${advanceMs}ms (将在北京时间 23:59:59.${String(1000 - advanceMs).padStart(3, '0')} 发射)`)
  console.log(`预计等待时间: ${(remainToMidnightMs / 1000 / 60 / 60).toFixed(2)} 小时 (${(remainToMidnightMs / 1000 / 60).toFixed(1)} 分钟)\n`)

  let refreshed3Min = false
  let refreshed30Sec = false

  // 4. 高精度倒计时监控
  while (true) {
    const nowB = getBeijingNow()
    const diff = wave1Target - nowB

    // 距离 3 分钟自动刷新一次 Token
    if (diff <= 3 * 60 * 1000 && diff > 35 * 1000 && !refreshed3Min) {
      refreshed3Min = true
      console.log(`\n[${formatBeijingTime(getBeijingNow())}] 距 0 点剩 3 分钟，执行初级 Token 刷新...`)
      await getAuthByPassports()
      await syncBeijingTime() // 顺便再校准一次时间
    }

    // 距离 30 秒进行终极刷新，确保 Token 处于极致鲜活状态
    if (diff <= 30 * 1000 && diff > 5 * 1000 && !refreshed30Sec) {
      refreshed30Sec = true
      console.log(`\n[${formatBeijingTime(getBeijingNow())}] 距 0 点仅 30 秒，执行终极 Token 保活刷新...`)
      await getAuthByPassports()
    }

    // 到达发射窗口
    if (diff <= 0) {
      console.log(`\n[${formatBeijingTime(getBeijingNow())}] 🔥 零点窗口开启！全速并发发射！`)
      break
    }

    // 还有较长时间：每秒显示倒计时
    if (diff > 5000) {
      const remainingSec = Math.floor(diff / 1000)
      const hours = Math.floor(remainingSec / 3600)
      const mins = Math.floor((remainingSec % 3600) / 60)
      const secs = remainingSec % 60
      process.stdout.write(`\r[标准北京时间] 倒计时: ${hours}小时 ${mins}分 ${secs}秒... `)
      await new Promise((r) => setTimeout(r, 1000))
    } else {
      // 最后 5 秒进入毫秒级高频轮询，精准命中毫秒点
      process.stdout.write(`\r[准备开火] 距离第 1 波发射仅剩: ${diff}ms...   `)
      if (diff > 15) {
        await new Promise((r) => setTimeout(r, 2))
      }
    }
  }

  // 5. 四波高密度连续压制轰炸（防 0 点瞬时补货延迟或网络微抖）
  grantCouponsByAuths(1)
  setTimeout(() => grantCouponsByAuths(2), 80)
  setTimeout(() => grantCouponsByAuths(3), 180)
  setTimeout(() => grantCouponsByAuths(4), 350)
}

/**
 * 命令行直接运行逻辑
 */
const mode = process.argv[2] || 'all'

if (mode === 'auth') {
  await getAuthByPassports()
} else if (mode === 'list') {
  await listCoupons()
} else if (mode === 'grant') {
  await grantCouponsByAuths()
} else if (mode === 'midnight') {
  const advance = parseInt(process.argv[3] || '80', 10)
  await scheduleMidnight(advance)
} else {
  // 默认：先刷新 auth，再抢券
  const auths = await getAuthByPassports()
  if (auths.length > 0) {
    await listCoupons()
    await grantCouponsByAuths()
  }
}
