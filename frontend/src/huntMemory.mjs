export function memoryFreshness(snapshot, now=Date.now()) {
 if(snapshot.valid_until&&Date.parse(snapshot.valid_until)<=now)return 'Expired now · historical snapshot';
 if(snapshot.valid_from&&Date.parse(snapshot.valid_from)>now)return 'Outside current validity window';
 return snapshot.valid_until?'Within configured validity window':'No expiry configured';
}
