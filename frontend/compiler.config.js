import compiler from 'babel-plugin-react-compiler';

export function compilerPlugins(flag = '1') {
  if (!['0', '1'].includes(flag)) throw new Error('AISOC_REACT_COMPILER must be 0 or 1');
  return flag === '0' ? [] : [[compiler, { target: '19' }]];
}
