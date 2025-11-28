import { exec } from 'child_process';
import { promisify } from 'util';
import { info, warn, error as logError } from '../logging/logger.js';

const execAsync = promisify(exec);

let cachedIp: string | null = null;
let cacheTime: number = 0;
const CACHE_DURATION = 60000; // 1 minute

export async function getTailscaleIp(): Promise<string | null> {
  // Return cached value if still valid
  if (cachedIp && Date.now() - cacheTime < CACHE_DURATION) {
    return cachedIp;
  }

  try {
    const { stdout, stderr } = await execAsync('tailscale ip -4', {
      timeout: 5000,
    });

    if (stderr) {
      warn(`Tailscale stderr: ${stderr}`, 'Tailscale');
    }

    const ip = stdout.trim().split('\n')[0];

    if (ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
      cachedIp = ip;
      cacheTime = Date.now();
      info(`Tailscale IP: ${ip}`, 'Tailscale');
      return ip;
    }

    warn(`Invalid Tailscale IP format: ${ip}`, 'Tailscale');
    return null;
  } catch (error) {
    logError(`Failed to get Tailscale IP: ${error}`, 'Tailscale');
    return null;
  }
}

export async function isTailscaleRunning(): Promise<boolean> {
  try {
    await execAsync('tailscale status', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function clearIpCache(): void {
  cachedIp = null;
  cacheTime = 0;
}
