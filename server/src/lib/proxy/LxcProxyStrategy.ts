import { IProxyStrategy, ProxyDeviceResult, ProxyDeviceConfig, ProxyDeviceTargetOptions, NamedProxyDeviceConfig } from './IProxyStrategy.js';

export class LxcProxyStrategy implements IProxyStrategy {
    createProxyDevice(
        _hostNatIp: string | null | undefined,
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
            const ipv4ListenAddr = _hostNatIp || '0.0.0.0'

            if (!ipv4ListenAddr || ipv4ListenAddr === '0.0.0.0') {
                return { success: false, errorMessage: 'Current host has no bindable IPv4 listen address for NAT port mapping. Please configure Listen IPv4 in host NAT settings.' };
            }
            if (!targetIpv4) {
                return { success: false, errorMessage: 'Current instance has no static IPv4 address for NAT port mapping.' };
            }

            deviceConfigs.push({
                deviceConfig: {
                    type: 'proxy',
                    listen: `${protocol}:${ipv4ListenAddr}:${publicPort}`,
                    connect: `${protocol}:${targetIpv4}:${privatePort}`,
                    nat: 'true'
                }
            })

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

            return { success: true, deviceConfigs }
        }

        let listenAddr: string;

        // 若要求带有内部 IPv6 穿透的规则，强迫提取确切外部地址保护通配符监听错误
        if (['ipv6_only', 'ipv6_nat'].includes(networkMode)) {
            if (!normalizedHostIpv6) {
                return { success: false, errorMessage: '当前所在节点暂无任何公网 IPv6 记录！请通知管理员在节点设置中补充【公网 IPv6 或 NAT IPv6 地址】，否则无法穿透映射。' };
            }
            listenAddr = `[${normalizedHostIpv6}]`;
        } else {
            listenAddr = _hostNatIp || '0.0.0.0';
        }

        const shouldUseIpv4Nat = !['ipv6_only', 'ipv6_nat'].includes(networkMode)
        if (shouldUseIpv4Nat) {
            if (!listenAddr || listenAddr === '0.0.0.0' || listenAddr === '[::]') {
                return { success: false, errorMessage: 'Current host has no bindable IPv4 listen address for NAT port mapping. Please configure Listen IPv4 in host NAT settings.' };
            }
            if (!targetIpv4) {
                return { success: false, errorMessage: 'Current instance has no static IPv4 address for NAT port mapping.' };
            }

            return {
                success: true,
                deviceConfig: {
                    type: 'proxy',
                    listen: `${protocol}:${listenAddr}:${publicPort}`,
                    connect: `${protocol}:${targetIpv4}:${privatePort}`,
                    nat: 'true'
                }
            };
        }

        // 普通情况下连接使用 0.0.0.0 自适应服务监听源；仅在仅含 IPv6 及无内网 V4 桥池的极端环境启用 [::] 防止 ECONNRESET
        const connectAddr = ['ipv6_only', 'ipv6_nat'].includes(networkMode) ? '[::]' : '0.0.0.0';

        const deviceConfig: ProxyDeviceConfig = {
            type: 'proxy',
            listen: `${protocol}:${listenAddr}:${publicPort}`,
            connect: `${protocol}:${connectAddr}:${privatePort}`
        };

        return { success: true, deviceConfig };
    }
}
