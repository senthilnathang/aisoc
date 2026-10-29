"""Linux-only resource sampling of the disposable PostgreSQL process tree."""
import json
import os
from pathlib import Path
import threading
import time


def process_stat(raw):
    # comm may contain spaces and parentheses; fields after the final ')' are stable.
    fields = raw.rsplit(')', 1)[1].split()
    return int(fields[19]), int(fields[11]) + int(fields[12]), int(fields[21])


class ResourceProbe:
    def __init__(self, pid, output):
        self.pid, self.output = pid, Path(output)
        self.stop = threading.Event()
        self.samples, self.errors, self.last, self.base = [], [], {}, {}
        self.started = time.monotonic()
        self.hz = os.sysconf('SC_CLK_TCK')
        self.page = os.sysconf('SC_PAGE_SIZE')

    def sample(self, initial=False):
        pending, seen, rss = [self.pid], set(), 0
        while pending:
            pid = pending.pop()
            if pid in seen:
                continue
            seen.add(pid)
            try:
                start, ticks, pages = process_stat(Path(f'/proc/{pid}/stat').read_text())
                key = (pid, start)
                if initial:
                    self.base[key] = ticks
                self.last[key] = ticks
                rss += pages * self.page
                pending.extend(int(n) for n in Path(f'/proc/{pid}/task/{pid}/children').read_text().split())
            except (FileNotFoundError, ProcessLookupError):
                continue
        memory = {}
        for line in Path('/proc/meminfo').read_text().splitlines():
            name, value = line.split(':', 1)
            if name in ('MemAvailable', 'MemTotal'):
                memory[name + '_bytes'] = int(value.split()[0]) * 1024
        self.samples.append({
            'elapsed_seconds': time.monotonic() - self.started,
            'postgres_observed_cpu_seconds': sum(max(0, v-self.base.get(k, 0)) for k, v in self.last.items()) / self.hz,
            'postgres_sum_rss_bytes': rss,
            'host_load_average': list(os.getloadavg()),
            'host_memory': memory,
        })

    def __enter__(self):
        self.sample(initial=True)
        def collect():
            while not self.stop.wait(1):
                try:
                    self.sample()
                except (OSError, ValueError, IndexError) as error:
                    if len(self.errors) < 5:
                        self.errors.append(type(error).__name__)
        self.thread = threading.Thread(target=collect, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.stop.set()
        self.thread.join()
        self.sample()
        self.output.write_text(json.dumps({
            'scope': 'Disposable PostgreSQL tree and host during go test invocation, including compilation/setup/cleanup; wider than timed event drain',
            'limits': 'Observed CPU is a lower bound if processes exit between samples. Summed RSS double-counts shared pages; not physical memory consumption. Host load/memory include unrelated workloads. No process command lines, environment or other process trees read.',
            'interval_seconds': 1,
            'measurement_command_succeeded': exc_type is None,
            'sampling_errors': self.errors,
            'samples': self.samples,
        }, indent=2) + '\n')
