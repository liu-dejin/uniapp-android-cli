import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMdnsServices } from '../../src/core/adb.js'
import {
  createPairingCode,
  createServiceName,
  hostOf,
  normalizeAddress,
  normalizePairingAddress,
  pairingPayload,
  selectPairingService,
  validatePairingCode,
  validateServiceName,
} from '../../src/core/devicePairing.js'
import { renderQr } from '../../src/core/qrcode.js'

test('二维码配对的服务名符合 mDNS 规则', () => {
  for (let index = 0; index < 20; index += 1) {
    const name = createServiceName()
    assert.ok(name.length <= 15)
    assert.match(name, /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/)
    assert.ok(!name.includes('--'))
    assert.match(name, /[A-Za-z]/)
  }
  assert.throws(() => validateServiceName('-abc'), /不合法/)
  assert.throws(() => validateServiceName('abc--def'), /不合法/)
  assert.throws(() => validateServiceName('a'.repeat(16)), /不合法/)
  assert.equal(validateServiceName('unipack-ab12'), 'unipack-ab12')
})

test('配对码为 6 位数字', () => {
  for (let index = 0; index < 20; index += 1) {
    assert.match(createPairingCode(), /^\d{6}$/)
  }
  assert.throws(() => validatePairingCode('12345'), /不合法/)
  assert.equal(validatePairingCode('123456'), '123456')
})

test('二维码内容使用 Android 的 WIFI:T:ADB 格式', () => {
  assert.equal(pairingPayload('unipack-ab12', '123456'), 'WIFI:T:ADB;S:unipack-ab12;P:123456;;')
})

test('设备地址补默认端口', () => {
  assert.equal(normalizeAddress('192.168.1.20'), '192.168.1.20:5555')
  assert.equal(normalizeAddress('192.168.1.20:4567'), '192.168.1.20:4567')
  assert.equal(normalizeAddress('fe80::1'), '[fe80::1]:5555')
  assert.equal(normalizeAddress('[fe80::1]:4567'), '[fe80::1]:4567')
  assert.equal(normalizeAddress('pad.local'), 'pad.local:5555')
  assert.throws(() => normalizeAddress('192.168.1.20:abc'), /端口不合法/)
  assert.throws(() => normalizeAddress(''), /请输入设备地址/)
})

test('手动配对地址必须带端口', () => {
  assert.equal(normalizePairingAddress('192.168.1.20:37123'), '192.168.1.20:37123')
  assert.equal(normalizePairingAddress('[fe80::1]:37123'), '[fe80::1]:37123')
  assert.throws(() => normalizePairingAddress('192.168.1.20'), /需要带端口/)
  assert.equal(hostOf('192.168.1.20:37123'), '192.168.1.20')
  assert.equal(hostOf('[fe80::1]:37123'), 'fe80::1')
})

test('解析 adb mdns services 输出（新版 3 列）', () => {
  const stdout = `List of discovered mdns services
unipack-ab12	_adb-tls-pairing._tcp	192.168.1.20:37123
adb-3B165N007DQ00000-hq66xZ	_adb-tls-connect._tcp	192.168.1.20:45221
`
  const services = parseMdnsServices(stdout)
  assert.deepEqual(services, [
    { name: 'unipack-ab12', type: 'pairing', host: '192.168.1.20', port: 37123, address: '192.168.1.20:37123' },
    {
      name: 'adb-3B165N007DQ00000-hq66xZ',
      type: 'connect',
      host: '192.168.1.20',
      port: 45221,
      address: '192.168.1.20:45221',
    },
  ])
})

test('解析 adb mdns services 输出（兼容老版 2 列）', () => {
  const stdout = `List of discovered mdns services
adb-ABC123._adb-tls-connect._tcp.	192.168.1.20:5555
unipack-ab12._adb-tls-pairing._tcp.	192.168.1.20:37123
other-service._http._tcp.	[fe80::1]:8080
`
  const services = parseMdnsServices(stdout)
  assert.equal(services.length, 3)
  assert.deepEqual(services[0], {
    name: 'adb-ABC123._adb-tls-connect._tcp.',
    type: 'connect',
    host: '192.168.1.20',
    port: 5555,
    address: '192.168.1.20:5555',
  })
  assert.equal(services[1].type, 'pairing')
  assert.equal(services[2].host, 'fe80::1')
  assert.equal(services[2].address, 'fe80::1:8080')
  assert.deepEqual(parseMdnsServices('ERROR: mdns daemon unavailable'), [])
})

test('手机广播的实例名与二维码服务名不同也能选中', () => {
  const seen = new Set(['10.0.0.2:37001'])
  const stale = { name: 'adb-old._adb-tls-pairing._tcp.', type: 'pairing', address: '10.0.0.2:37001' }
  const fresh = { name: 'adb-phone._adb-tls-pairing._tcp.', type: 'pairing', address: '10.0.0.2:41000' }
  const other = { name: 'adb-other._adb-tls-pairing._tcp.', type: 'pairing', address: '10.0.0.3:41001' }
  const named = { name: 'unipack-ab12._adb-tls-pairing._tcp.', type: 'pairing', address: '10.0.0.4:41002' }

  assert.equal(selectPairingService([stale, fresh], seen, 'unipack-ab12'), fresh)
  assert.equal(selectPairingService([stale], seen, 'unipack-ab12'), stale)
  assert.equal(selectPairingService([stale, fresh, other], seen, 'unipack-ab12'), null)
  assert.equal(selectPairingService([stale, fresh, named], seen, 'unipack-ab12'), named)
  // 新版 adb 的实例名与二维码里的 S 完全一致
  const exact = { name: 'unipack-ab12', type: 'pairing', address: '10.0.0.5:41003' }
  assert.equal(selectPairingService([stale, exact], seen, 'unipack-ab12'), exact)
  assert.equal(selectPairingService([], seen, 'unipack-ab12'), null)
})

test('终端二维码可以渲染', () => {
  const output = renderQr(pairingPayload('unipack-ab12', '123456'))
  assert.ok(output.length > 100)
  assert.ok(/[▀▄█]/.test(output))
})
