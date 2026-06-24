import { IProxyStrategy, ProxyDeviceResult, ProxyDeviceConfig, NamedProxyDeviceConfig, ProxyDeviceTargetOptions } from './IProxyStrategy.js'

export class KvmProxyStrategy implements IProxyStrategy {
    createProxyDevice(
        hostNatIp: string | null | undefined,
        hostIpv6: string | null | undefined,
        networkMode: string,
        protocol: string,
        publicPort: number,
        privatePort: number,
        targetOptions: ProxyDeviceTargetOptions = {}
    ): ProxyDeviceResult {
        const targetIpv4 = targetOptions.targetIpv4?.trim()
        const normalizedHostIpv6 = hostIpv6?.trim().replace(/^\[|\]$/g, '')

        if (networkMode === 'nat_ipv6_nat') {
            const deviceConfigs: NamedProxyDeviceConfig[] = []

            if (hostNatIp && hostNatIp !== '0.0.0.0') {
                if (!targetIpv4) {
                    return {
                        success: false,
                        errorMessage: 'Current instance has no static IPv4 address for KVM NAT port mapping.'
                    }
                }
                deviceConfigs.push({
                    deviceConfig: {
                        type: 'proxy',
                        listen: `${protocol}:${hostNatIp}:${publicPort}`,
                        connect: `${protocol}:${targetIpv4}:${privatePort}`,
                        nat: 'true'
                    }
                })
            }

            if (normalizedHostIpv6) {
                deviceConfigs.push({
                    nameSuffix: '-v6',
                    deviceConfig: {
                        type: 'proxy',
                        listen: `${protocol}:[${normalizedHostIpv6}]:${publicPort}`,
                        connect: `${protocol}:0.0.0.0:${privatePort}`
                    }
                })
            }

            if (deviceConfigs.length === 0) {
                return {
                    success: false,
                    errorMessage: 'Current host has no usable NAT public IPv4 or IPv6 address for KVM port mapping.'
                }
            }

            return { success: true, deviceConfigs }
        }

        let listenAddr: string

        if (['ipv6_only', 'ipv6_nat'].includes(networkMode)) {
            if (!normalizedHostIpv6) {
                return {
                    success: false,
                    errorMessage: 'Current host has no public IPv6/NAT IPv6 configured for KVM port mapping.'
                }
            }
            listenAddr = `[${normalizedHostIpv6}]`
        } else {
            if (!hostNatIp || hostNatIp === '0.0.0.0') {
                return {
                    success: false,
                    errorMessage: 'Current host has no bindable IPv4 listen address for KVM port mapping. Please configure a local Listen IPv4 address in host NAT settings.'
                }
            }
            listenAddr = hostNatIp
        }

        const connectAddr = networkMode === 'ipv6_only' ? '[::]' : '0.0.0.0'

        if (!['ipv6_only', 'ipv6_nat'].includes(networkMode) && !targetIpv4) {
            return {
                success: false,
                errorMessage: 'Current instance has no static IPv4 address for KVM NAT port mapping.'
            }
        }

        const deviceConfig: ProxyDeviceConfig = {
            type: 'proxy',
            listen: `${protocol}:${listenAddr}:${publicPort}`,
            connect: `${protocol}:${!['ipv6_only', 'ipv6_nat'].includes(networkMode) ? targetIpv4 : connectAddr}:${privatePort}`
        }

        if (networkMode !== 'ipv6_nat') {
            deviceConfig.nat = 'true'
        }

        return { success: true, deviceConfig }
    }
}
