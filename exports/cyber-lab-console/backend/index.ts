import { db, error, json, router } from '@appdeploy/sdk';

type AgentRecord = {
  name: string;
  platform: string;
  createdAt: number;
  lastSeen: number;
};
type JobRecord = {
  agentId: string;
  module: string;
  target: string;
  createdAt: number;
};
type ResultRecord = {
  agentId: string;
  module: string;
  target: string;
  createdAt: number;
  completedAt: number;
  result: Record<string, unknown>;
};

type MobileRecord = {
  name: string;
  model: string;
  systemName: string;
  systemVersion: string;
  appVersion: string;
  batteryLevel: number;
  batteryState: string;
  lowPowerMode: boolean;
  freeBytes: number;
  totalBytes: number;
  network: string;
  createdAt: number;
  lastSeen: number;
};

type GatewayRecord = {
  name: string;
  version: string;
  createdAt: number;
  lastSeen: number;
};

type MdmDeviceRecord = {
  enrollmentId: string;
  deviceName: string;
  model: string;
  osVersion: string;
  serialNumber: string;
  supervised: boolean;
  status: string;
  lastSeen: number;
};

type MdmCommandRecord = {
  deviceId: string;
  enrollmentId: string;
  command: string;
  args: Record<string, unknown>;
  status: string;
  createdAt: number;
  updatedAt: number;
  result?: Record<string, unknown>;
};

const allowedModules = new Set([
  'port_scan',
  'lan_discover',
  'http_audit',
  'tls_audit',
  'system_info',
]);

const allowedMdmCommands = new Set([
  'DeviceInformation',
  'SecurityInfo',
  'ProfileList',
  'InstalledApplicationList',
  'Restrictions',
  'DeviceLock',
  'ClearPasscode',
  'RestartDevice',
  'ShutDownDevice',
  'EraseDevice',
]);

const destructiveMdmCommands = new Set([
  'DeviceLock',
  'ClearPasscode',
  'RestartDevice',
  'ShutDownDevice',
  'EraseDevice',
]);

function bodyOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
function workspacePrefix(key: unknown) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))
    throw new Error('Invalid workspace key.');
  return key.slice(0, 32);
}
function tables(key: unknown) {
  const p = workspacePrefix(key);
  return {
    agents: 'agents_' + p,
    jobs: 'jobs_' + p,
    results: 'results_' + p,
    mobile: 'mobile_' + p,
    gateways: 'gateways_' + p,
    mdmDevices: 'mdm_devices_' + p,
    mdmCommands: 'mdm_commands_' + p,
  };
}
function isPrivateIPv4(value: string) {
  const p = value.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255))
    return false;
  return (
    p[0] === 10 ||
    p[0] === 127 ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 169 && p[1] === 254)
  );
}
function isPrivateCidr(value: string) {
  const [ip, raw] = value.split('/');
  const prefix = Number(raw);
  return (
    isPrivateIPv4(ip) &&
    Number.isInteger(prefix) &&
    prefix >= 24 &&
    prefix <= 32
  );
}
function validateTarget(module: string, target: unknown) {
  if (module === 'system_info') return 'local-agent';
  if (typeof target !== 'string') throw new Error('Target is required.');
  if (module === 'lan_discover') {
    if (!isPrivateCidr(target))
      throw new Error(
        'Only private CIDR ranges with /24 or smaller scope are allowed.'
      );
  } else if (!isPrivateIPv4(target)) {
    throw new Error('Only private IPv4 targets are allowed.');
  }
  return target;
}
async function ownedAgent(table: string, id: unknown) {
  if (typeof id !== 'string' || !id) return null;
  const [record] = await db.get<AgentRecord>(table, [id]);
  return record ? { id, ...record } : null;
}
function appError(e: unknown) {
  return error(e instanceof Error ? e.message : 'Request failed.', 400);
}

export const handler = router({
  'GET /api/_healthcheck': [
    async () => json({ ok: true, scope: 'private-networks-only' }),
  ],

  'POST /api/agent/register': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const name =
          typeof b.name === 'string' ? b.name.slice(0, 80) : 'Lab Agent';
        const platform =
          typeof b.platform === 'string' ? b.platform.slice(0, 180) : 'Unknown';
        const now = Date.now() / 1000;
        const [id] = await db.add(t.agents, [
          { name, platform, createdAt: now, lastSeen: now },
        ]);
        if (!id) return error('Could not register agent.', 500);
        return json({ ok: true, agentId: id });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/agents/list': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const { items } = await db.list<AgentRecord>(t.agents, { limit: 25 });
        items.sort((a, b) => b.lastSeen - a.lastSeen);
        return json({ ok: true, agents: items });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/jobs/create': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const module = typeof b.module === 'string' ? b.module : '';
        if (!allowedModules.has(module))
          return error('Unsupported assessment module.', 400);
        const agent = await ownedAgent(t.agents, b.agentId);
        if (!agent) return error('Unknown agent.', 404);
        const target = validateTarget(module, b.target);
        const { items } = await db.list<JobRecord>(t.jobs, { limit: 25 });
        const pending = items.filter(j => j.agentId === agent.id).length;
        if (pending >= 5)
          return error('This agent already has five pending jobs.', 429);
        const [id] = await db.add(t.jobs, [
          { agentId: agent.id, module, target, createdAt: Date.now() / 1000 },
        ]);
        if (!id) return error('Could not queue job.', 500);
        return json({ ok: true, jobId: id });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/agent/poll': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const agent = await ownedAgent(t.agents, b.agentId);
        if (!agent) return error('Unknown agent.', 404);
        const now = Date.now() / 1000;
        await db.update(t.agents, [
          {
            id: agent.id,
            record: {
              name: agent.name,
              platform: agent.platform,
              createdAt: agent.createdAt,
              lastSeen: now,
            },
          },
        ]);
        const { items } = await db.list<JobRecord>(t.jobs, {
          filter: { agentId: agent.id },
          limit: 20,
        });
        const job = items.find(j => j.agentId === agent.id);
        return json({ ok: true, job: job || null });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/agent/result': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const agent = await ownedAgent(t.agents, b.agentId);
        if (!agent) return error('Unknown agent.', 404);
        if (typeof b.jobId !== 'string') return error('Invalid job.', 400);
        const [job] = await db.get<JobRecord>(t.jobs, [b.jobId]);
        if (!job || job.agentId !== agent.id)
          return error('Job not found.', 404);
        const result =
          b.result && typeof b.result === 'object'
            ? (b.result as Record<string, unknown>)
            : { error: 'Malformed agent result' };
        const record: ResultRecord = {
          agentId: agent.id,
          module: job.module,
          target: job.target,
          createdAt: job.createdAt,
          completedAt: Date.now() / 1000,
          result,
        };
        await db.add(t.results, [record]);
        await db.delete(t.jobs, [b.jobId]);
        return json({ ok: true });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/results/list': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const { items } = await db.list<ResultRecord>(t.results, { limit: 40 });
        items.sort((a, b) => b.completedAt - a.completedAt);
        return json({ ok: true, results: items });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/results/clear': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const { items } = await db.list<ResultRecord>(t.results, {
          limit: 100,
        });
        if (items.length)
          await db.delete(
            t.results,
            items.map(i => i.id)
          );
        return json({ ok: true, deleted: items.length });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/mobile/register': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const now = Date.now() / 1000;
        const record: MobileRecord = {
          name: typeof b.name === 'string' ? b.name.slice(0, 80) : 'iPhone',
          model: typeof b.model === 'string' ? b.model.slice(0, 80) : 'iPhone',
          systemName: typeof b.systemName === 'string' ? b.systemName.slice(0, 40) : 'iOS',
          systemVersion: typeof b.systemVersion === 'string' ? b.systemVersion.slice(0, 40) : '',
          appVersion: typeof b.appVersion === 'string' ? b.appVersion.slice(0, 40) : '',
          batteryLevel: typeof b.batteryLevel === 'number' ? b.batteryLevel : -1,
          batteryState: typeof b.batteryState === 'string' ? b.batteryState.slice(0, 30) : 'unknown',
          lowPowerMode: b.lowPowerMode === true,
          freeBytes: typeof b.freeBytes === 'number' ? b.freeBytes : 0,
          totalBytes: typeof b.totalBytes === 'number' ? b.totalBytes : 0,
          network: typeof b.network === 'string' ? b.network.slice(0, 80) : 'unknown',
          createdAt: now,
          lastSeen: now,
        };
        const [id] = await db.add(t.mobile, [record]);
        if (!id) return error('Could not register iPhone Companion.', 500);
        return json({ ok: true, deviceId: id });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/mobile/heartbeat': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        if (typeof b.deviceId !== 'string') return error('Invalid mobile device.', 400);
        const [existing] = await db.get<MobileRecord>(t.mobile, [b.deviceId]);
        if (!existing) return error('Mobile device not found.', 404);
        const record: MobileRecord = {
          ...existing,
          name: typeof b.name === 'string' ? b.name.slice(0, 80) : existing.name,
          model: typeof b.model === 'string' ? b.model.slice(0, 80) : existing.model,
          systemName: typeof b.systemName === 'string' ? b.systemName.slice(0, 40) : existing.systemName,
          systemVersion: typeof b.systemVersion === 'string' ? b.systemVersion.slice(0, 40) : existing.systemVersion,
          appVersion: typeof b.appVersion === 'string' ? b.appVersion.slice(0, 40) : existing.appVersion,
          batteryLevel: typeof b.batteryLevel === 'number' ? b.batteryLevel : existing.batteryLevel,
          batteryState: typeof b.batteryState === 'string' ? b.batteryState.slice(0, 30) : existing.batteryState,
          lowPowerMode: typeof b.lowPowerMode === 'boolean' ? b.lowPowerMode : existing.lowPowerMode,
          freeBytes: typeof b.freeBytes === 'number' ? b.freeBytes : existing.freeBytes,
          totalBytes: typeof b.totalBytes === 'number' ? b.totalBytes : existing.totalBytes,
          network: typeof b.network === 'string' ? b.network.slice(0, 80) : existing.network,
          lastSeen: Date.now() / 1000,
        };
        const [ok] = await db.update(t.mobile, [{ id: b.deviceId, record }]);
        if (!ok) return error('Could not update iPhone Companion.', 500);
        return json({ ok: true });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/mobile/list': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const { items } = await db.list<MobileRecord>(t.mobile, { limit: 50 });
        items.sort((a, b) => b.lastSeen - a.lastSeen);
        return json({ ok: true, devices: items });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/mdm/gateway/register': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const now = Date.now() / 1000;
        const [id] = await db.add(t.gateways, [{
          name: typeof b.name === 'string' ? b.name.slice(0, 80) : 'NanoMDM Gateway',
          version: typeof b.version === 'string' ? b.version.slice(0, 40) : '1.0',
          createdAt: now,
          lastSeen: now,
        }]);
        if (!id) return error('Could not register MDM gateway.', 500);
        return json({ ok: true, gatewayId: id });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/mdm/gateway/heartbeat': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        if (typeof b.gatewayId !== 'string') return error('Invalid gateway.', 400);
        const [existing] = await db.get<GatewayRecord>(t.gateways, [b.gatewayId]);
        if (!existing) return error('Gateway not found.', 404);
        await db.update(t.gateways, [{
          id: b.gatewayId,
          record: {
            ...existing,
            version: typeof b.version === 'string' ? b.version.slice(0, 40) : existing.version,
            lastSeen: Date.now() / 1000,
          },
        }]);
        return json({ ok: true });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/mdm/gateway/status': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const { items } = await db.list<GatewayRecord>(t.gateways, { limit: 10 });
        items.sort((a, b) => b.lastSeen - a.lastSeen);
        return json({ ok: true, gateways: items });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/mdm/device/upsert': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        if (typeof b.enrollmentId !== 'string' || !b.enrollmentId) return error('Enrollment ID is required.', 400);
        const { items } = await db.list<MdmDeviceRecord>(t.mdmDevices, { limit: 100 });
        const existing = items.find(d => d.enrollmentId === b.enrollmentId);
        const record: MdmDeviceRecord = {
          enrollmentId: b.enrollmentId.slice(0, 200),
          deviceName: typeof b.deviceName === 'string' ? b.deviceName.slice(0, 100) : existing?.deviceName || '',
          model: typeof b.model === 'string' ? b.model.slice(0, 100) : existing?.model || '',
          osVersion: typeof b.osVersion === 'string' ? b.osVersion.slice(0, 60) : existing?.osVersion || '',
          serialNumber: typeof b.serialNumber === 'string' ? b.serialNumber.slice(0, 100) : existing?.serialNumber || '',
          supervised: typeof b.supervised === 'boolean' ? b.supervised : existing?.supervised || false,
          status: typeof b.status === 'string' ? b.status.slice(0, 40) : 'Enrolled',
          lastSeen: Date.now() / 1000,
        };
        if (existing) {
          await db.update(t.mdmDevices, [{ id: existing.id, record }]);
          return json({ ok: true, deviceId: existing.id });
        }
        const [id] = await db.add(t.mdmDevices, [record]);
        if (!id) return error('Could not add MDM device.', 500);
        return json({ ok: true, deviceId: id });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/mdm/devices/list': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const { items } = await db.list<MdmDeviceRecord>(t.mdmDevices, { limit: 100 });
        items.sort((a, b) => b.lastSeen - a.lastSeen);
        return json({ ok: true, devices: items });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/mdm/commands/create': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const command = typeof b.command === 'string' ? b.command : '';
        if (!allowedMdmCommands.has(command)) return error('Unsupported MDM command.', 400);
        if (typeof b.deviceId !== 'string') return error('MDM device is required.', 400);
        const [device] = await db.get<MdmDeviceRecord>(t.mdmDevices, [b.deviceId]);
        if (!device) return error('MDM device not found.', 404);
        if (destructiveMdmCommands.has(command)) {
          const required = command === 'EraseDevice' ? 'ERASE' : 'CONFIRM';
          if (b.confirm !== required) return error('Explicit confirmation is required for this command.', 400);
        }
        const now = Date.now() / 1000;
        const [id] = await db.add(t.mdmCommands, [{
          deviceId: b.deviceId,
          enrollmentId: device.enrollmentId,
          command,
          args: b.args && typeof b.args === 'object' ? b.args as Record<string, unknown> : {},
          status: 'queued',
          createdAt: now,
          updatedAt: now,
        }]);
        if (!id) return error('Could not queue MDM command.', 500);
        return json({ ok: true, commandId: id });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/mdm/commands/list': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const { items } = await db.list<MdmCommandRecord>(t.mdmCommands, { limit: 100 });
        items.sort((a, b) => b.updatedAt - a.updatedAt);
        return json({ ok: true, commands: items });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/mdm/commands/poll': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        const { items } = await db.list<MdmCommandRecord>(t.mdmCommands, { limit: 100 });
        const item = items.find(c => c.status === 'queued');
        if (!item) return json({ ok: true, command: null });
        const record: MdmCommandRecord = { ...item, status: 'dispatched', updatedAt: Date.now() / 1000 };
        delete (record as Record<string, unknown>).id;
        await db.update(t.mdmCommands, [{ id: item.id, record }]);
        return json({ ok: true, command: { id: item.id, ...record } });
      } catch (e) {
        return appError(e);
      }
    },
  ],

  'POST /api/mdm/commands/result': [
    async ({ body }) => {
      try {
        const b = bodyOf(body);
        const t = tables(b.workspaceKey);
        if (typeof b.commandId !== 'string') return error('Invalid command.', 400);
        const [existing] = await db.get<MdmCommandRecord>(t.mdmCommands, [b.commandId]);
        if (!existing) return error('Command not found.', 404);
        const record: MdmCommandRecord = {
          ...existing,
          status: b.ok === true ? 'completed' : 'failed',
          updatedAt: Date.now() / 1000,
          result: b.result && typeof b.result === 'object' ? b.result as Record<string, unknown> : {},
        };
        await db.update(t.mdmCommands, [{ id: b.commandId, record }]);
        return json({ ok: true });
      } catch (e) {
        return appError(e);
      }
    },
  ],

});
