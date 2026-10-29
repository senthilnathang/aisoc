// Resolve static routes before parameter routes, as the HTTP router does.
export function routeFor(routes, event) {
  const segments = event.path.split('?')[0].split('/');
  return routes.filter(route => route.method === event.method &&
    route.path.split('/').length === segments.length &&
    route.path.split('/').every((part, index) => part.startsWith(':') || part === segments[index]))
    .sort((a, b) => {
      const left = a.path.split('/'), right = b.path.split('/');
      for (let i = 0; i < left.length; i++) {
        const difference = Number(left[i].startsWith(':')) - Number(right[i].startsWith(':'));
        if (difference) return difference;
      }
      return 0;
    })[0];
}

export function probeCoverage(routes, events) {
  const matched = new Set(events.map(event => {
    const route = routeFor(routes, event);
    return route && route.method + ' ' + route.path;
  }).filter(Boolean));
  return {
    covered: matched.size, total: routes.length,
    note: 'Probe coverage is not full behavioral coverage',
    routes: [...matched].sort(),
    missing: routes.map(route => route.method + ' ' + route.path).filter(key => !matched.has(key)),
  };
}
