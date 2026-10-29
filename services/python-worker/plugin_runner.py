"""One allowlisted trusted plugin per isolated process; no dynamic module loading."""
import resource
import sys

resource.setrlimit(resource.RLIMIT_AS, (128 * 1024 * 1024, 128 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
resource.setrlimit(resource.RLIMIT_NOFILE, (16, 16))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

def main():
    if sys.argv[1:] != ['python.normalize']:
        return 2
    data = sys.stdin.buffer.read(65537)
    if len(data) > 65536:
        return 3
    try:
        result = ' '.join(data.decode('utf-8').split()).lower().encode('utf-8')
    except UnicodeDecodeError:
        return 4
    if len(result) > 65536:
        return 3
    sys.stdout.buffer.write(result)
    return 0

if __name__ == '__main__':
    sys.exit(main())
