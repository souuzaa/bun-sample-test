import { readFileSync } from 'fs';
import { meter } from './metrics';

// TCP connection state mapping (hex to name)
const TCP_STATES: Record<string, string> = {
  '01': 'ESTABLISHED',
  '02': 'SYN_SENT',
  '03': 'SYN_RECV',
  '04': 'FIN_WAIT1',
  '05': 'FIN_WAIT2',
  '06': 'TIME_WAIT',
  '07': 'CLOSE',
  '08': 'CLOSE_WAIT',
  '09': 'LAST_ACK',
  '0A': 'LISTEN',
  '0B': 'CLOSING',
};

// Create observable gauges and counters
const tcpConnectionStatesGauge = meter.createObservableGauge(
  'tcp_connection_states',
  {
    description: 'Number of TCP connections by state',
    unit: 'connections',
  }
);

const tcpRetransmitsTotalCounter = meter.createObservableCounter(
  'tcp_retransmits_total',
  {
    description: 'Total number of TCP retransmits',
    unit: 'segments',
  }
);

const tcpSegmentsSentTotalCounter = meter.createObservableCounter(
  'tcp_segments_sent_total',
  {
    description: 'Total number of TCP segments sent',
    unit: 'segments',
  }
);

const tcpListenOverflowsTotalCounter = meter.createObservableCounter(
  'tcp_listen_overflows_total',
  {
    description: 'Total number of TCP listen queue overflows',
    unit: 'overflows',
  }
);

/**
 * Get TCP connection counts per state by parsing the system's proc filesystem.
 *
 * Attempts to read /host/proc/net/tcp then /proc/net/tcp; on read or parse failure all known states map to 0 and an error is logged.
 *
 * @returns A record mapping each TCP state name to its connection count
 */
function getTcpConnectionStates(): Record<string, number> {
  const stateCounts: Record<string, number> = {};

  // Initialize all states to 0
  for (const stateName of Object.values(TCP_STATES)) {
    stateCounts[stateName] = 0;
  }

  try {
    // Try /host/proc first (for containerized environments), fallback to /proc
    let content: string;
    try {
      content = readFileSync('/host/proc/net/tcp', 'utf8');
    } catch {
      content = readFileSync('/proc/net/tcp', 'utf8');
    }

    const lines = content.trim().split('\n');
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(/\s+/);
      // State is in column 3 (0-indexed), in hex format
      if (parts.length >= 4) {
        const stateHex = parts[3].toUpperCase();
        const stateName = TCP_STATES[stateHex];
        if (stateName) {
          stateCounts[stateName]++;
        }
      }
    }
  } catch (error) {
    // Return zeros if we can't read the file
    console.error('Failed to read TCP connection states:', error);
  }

  return stateCounts;
}

/**
 * Parse system TCP SNMP metrics and extract RetransSegs and OutSegs.
 *
 * Reads /host/proc/net/snmp with a fallback to /proc/net/snmp and parses the first two lines that start with `Tcp:` to locate header and value columns. If the expected fields are missing or the file cannot be read, returns zeros.
 *
 * @returns An object with `retransSegs` — the number of retransmitted TCP segments, and `outSegs` — the number of TCP segments sent; each is `0` if not found or on error.
 */
function getTcpStats(): { retransSegs: number; outSegs: number } {
  try {
    let content: string;
    try {
      content = readFileSync('/host/proc/net/snmp', 'utf8');
    } catch {
      content = readFileSync('/proc/net/snmp', 'utf8');
    }

    const lines = content.trim().split('\n');

    // Find the Tcp header and values lines
    let tcpHeaderLine: string | null = null;
    let tcpValuesLine: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('Tcp:')) {
        if (!tcpHeaderLine) {
          tcpHeaderLine = lines[i];
        } else {
          tcpValuesLine = lines[i];
          break;
        }
      }
    }

    if (!tcpHeaderLine || !tcpValuesLine) {
      return { retransSegs: 0, outSegs: 0 };
    }

    const headers = tcpHeaderLine.split(/\s+/);
    const values = tcpValuesLine.split(/\s+/);

    const retransSegsIndex = headers.indexOf('RetransSegs');
    const outSegsIndex = headers.indexOf('OutSegs');

    return {
      retransSegs: retransSegsIndex >= 0 ? parseInt(values[retransSegsIndex], 10) || 0 : 0,
      outSegs: outSegsIndex >= 0 ? parseInt(values[outSegsIndex], 10) || 0 : 0,
    };
  } catch (error) {
    console.error('Failed to read TCP stats:', error);
    return { retransSegs: 0, outSegs: 0 };
  }
}

/**
 * Retrieve the kernel TCP `ListenOverflows` counter from the system netstat file.
 *
 * @returns The `ListenOverflows` value as an integer, or `0` if the field is missing or the file cannot be read/parsed.
 */
function getListenOverflows(): number {
  try {
    let content: string;
    try {
      content = readFileSync('/host/proc/net/netstat', 'utf8');
    } catch {
      content = readFileSync('/proc/net/netstat', 'utf8');
    }

    const lines = content.trim().split('\n');

    // Find the TcpExt header and values lines
    let tcpExtHeaderLine: string | null = null;
    let tcpExtValuesLine: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('TcpExt:')) {
        if (!tcpExtHeaderLine) {
          tcpExtHeaderLine = lines[i];
        } else {
          tcpExtValuesLine = lines[i];
          break;
        }
      }
    }

    if (!tcpExtHeaderLine || !tcpExtValuesLine) {
      return 0;
    }

    const headers = tcpExtHeaderLine.split(/\s+/);
    const values = tcpExtValuesLine.split(/\s+/);

    const listenOverflowsIndex = headers.indexOf('ListenOverflows');

    return listenOverflowsIndex >= 0 ? parseInt(values[listenOverflowsIndex], 10) || 0 : 0;
  } catch (error) {
    console.error('Failed to read listen overflows:', error);
    return 0;
  }
}

/**
 * Registers a batch observable callback that updates kernel TCP metrics.
 *
 * The callback reads kernel proc files and records:
 * - per-state TCP connection counts on `tcpConnectionStatesGauge`
 * - `RetransSegs` on `tcpRetransmitsTotalCounter`
 * - `OutSegs` on `tcpSegmentsSentTotalCounter`
 * - `ListenOverflows` on `tcpListenOverflowsTotalCounter`
 */
export function registerKernelMetrics(): void {
  // Register batch observable callback for all kernel metrics
  meter.addBatchObservableCallback(
    (observableResult) => {
      // TCP connection states
      const connectionStates = getTcpConnectionStates();
      for (const [state, count] of Object.entries(connectionStates)) {
        observableResult.observe(tcpConnectionStatesGauge, count, { state });
      }

      // TCP stats from /proc/net/snmp
      const tcpStats = getTcpStats();
      observableResult.observe(tcpRetransmitsTotalCounter, tcpStats.retransSegs);
      observableResult.observe(tcpSegmentsSentTotalCounter, tcpStats.outSegs);

      // Listen overflows from /proc/net/netstat
      const listenOverflows = getListenOverflows();
      observableResult.observe(tcpListenOverflowsTotalCounter, listenOverflows);
    },
    [
      tcpConnectionStatesGauge,
      tcpRetransmitsTotalCounter,
      tcpSegmentsSentTotalCounter,
      tcpListenOverflowsTotalCounter,
    ]
  );

  console.log('Kernel metrics registered successfully');
}