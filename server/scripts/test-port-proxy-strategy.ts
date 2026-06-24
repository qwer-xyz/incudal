import assert from 'node:assert/strict'
import { ProxyStrategyFactory } from '../src/lib/proxy/index.js'
import { normalizeIpv4Address } from '../src/lib/network-address.js'

assert.equal(normalizeIpv4Address('10.10.1.23/22'), '10.10.1.23')
assert.equal(normalizeIpv4Address('not-an-ip'), null)

const lxcNat = ProxyStrategyFactory.getStrategy('container').createProxyDevice(
  '10.170.0.3',
  null,
  'nat',
  'tcp',
  12345,
  80,
  { targetIpv4: '10.10.1.23' }
)

assert.equal(lxcNat.success, true)
assert.deepEqual(lxcNat.deviceConfig, {
  type: 'proxy',
  listen: 'tcp:10.170.0.3:12345',
  connect: 'tcp:10.10.1.23:80',
  nat: 'true'
})

const lxcMissingTarget = ProxyStrategyFactory.getStrategy('container').createProxyDevice(
  '10.170.0.3',
  null,
  'nat',
  'tcp',
  12345,
  80
)

assert.equal(lxcMissingTarget.success, false)

const lxcWildcardListen = ProxyStrategyFactory.getStrategy('container').createProxyDevice(
  '0.0.0.0',
  null,
  'nat',
  'tcp',
  12345,
  80,
  { targetIpv4: '10.10.1.23' }
)

assert.equal(lxcWildcardListen.success, false)

const lxcDualStack = ProxyStrategyFactory.getStrategy('container').createProxyDevice(
  '10.170.0.3',
  '[2001:db8::10]',
  'nat_ipv6_nat',
  'tcp',
  45678,
  8080,
  { targetIpv4: '10.10.1.26' }
)

assert.equal(lxcDualStack.success, true)
assert.deepEqual(lxcDualStack.deviceConfigs, [
  {
    deviceConfig: {
      type: 'proxy',
      listen: 'tcp:10.170.0.3:45678',
      connect: 'tcp:10.10.1.26:8080',
      nat: 'true'
    }
  },
  {
    nameSuffix: '-v6',
    deviceConfig: {
      type: 'proxy',
      listen: 'tcp:[2001:db8::10]:45678',
      connect: 'tcp:0.0.0.0:8080'
    }
  }
])

const kvmNat = ProxyStrategyFactory.getStrategy('virtual-machine').createProxyDevice(
  '10.170.0.3',
  null,
  'nat',
  'udp',
  23456,
  53,
  { targetIpv4: '10.10.1.24' }
)

assert.equal(kvmNat.success, true)
assert.deepEqual(kvmNat.deviceConfig, {
  type: 'proxy',
  listen: 'udp:10.170.0.3:23456',
  connect: 'udp:10.10.1.24:53',
  nat: 'true'
})

const kvmIpv6Nat = ProxyStrategyFactory.getStrategy('virtual-machine').createProxyDevice(
  '10.170.0.3',
  '[2001:db8::10]',
  'ipv6_nat',
  'tcp',
  34567,
  443,
  { targetIpv4: '10.10.1.25' }
)

assert.equal(kvmIpv6Nat.success, true)
assert.deepEqual(kvmIpv6Nat.deviceConfig, {
  type: 'proxy',
  listen: 'tcp:[2001:db8::10]:34567',
  connect: 'tcp:0.0.0.0:443'
})

const kvmDualStack = ProxyStrategyFactory.getStrategy('virtual-machine').createProxyDevice(
  '10.170.0.3',
  '2001:db8::10',
  'nat_ipv6_nat',
  'udp',
  45679,
  5353,
  { targetIpv4: '10.10.1.27' }
)

assert.equal(kvmDualStack.success, true)
assert.deepEqual(kvmDualStack.deviceConfigs, [
  {
    deviceConfig: {
      type: 'proxy',
      listen: 'udp:10.170.0.3:45679',
      connect: 'udp:10.10.1.27:5353',
      nat: 'true'
    }
  },
  {
    nameSuffix: '-v6',
    deviceConfig: {
      type: 'proxy',
      listen: 'udp:[2001:db8::10]:45679',
      connect: 'udp:0.0.0.0:5353'
    }
  }
])

console.log('port proxy strategy: ok')
