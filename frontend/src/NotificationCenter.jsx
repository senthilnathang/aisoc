import {useEffect,useState} from 'react';
import {Alert,AlertIcon,Badge,Box,Button,Flex,Modal,ModalBody,ModalCloseButton,ModalContent,ModalHeader,ModalOverlay,Stack,Text} from '@chakra-ui/react';
import {api} from './api';
import {ui} from './theme';
import {notificationLink} from './approvalOwnership';
export default function NotificationCenter({operatorId,tenantId}) {
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0),[error,setError]=useState('');
 useEffect(()=>{let active=true;const load=()=>api.request(`/notifications?limit=25&offset=${offset}`).then(x=>{if(active){setData(x);setError('');}}).catch(e=>{if(active)setError(e.message);});load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},30000);window.addEventListener('aisoc:notifications-changed',load);return()=>{active=false;clearInterval(timer);window.removeEventListener('aisoc:notifications-changed',load);};},[operatorId,tenantId,offset,revision]);
 const read=async id=>{try{await api.request(`/notifications/${encodeURIComponent(id)}/read`,{method:'POST',body:{}});setRevision(x=>x+1);}catch(e){setError(e.message);}};
 return <><Button size="xs" variant="ghost" aria-label={`Notifications, ${data?.unread||0} unread`} onClick={()=>{setOpen(true);setRevision(x=>x+1);}}>Notifications {data?.unread>0&&<Badge ml="5px" colorScheme="blue">{data.unread}</Badge>}</Button>
 <Modal isOpen={open} onClose={()=>setOpen(false)} size="xl"><ModalOverlay/><ModalContent mx="12px"><ModalHeader>In-app notifications</ModalHeader><ModalCloseButton/><ModalBody pb="24px"><Text fontSize="sm" color={ui.muted} mb="12px">Your approval ownership activity · {data?.unread||0} unread. These are historical handoffs; open the inbox for current ownership and expiry.</Text>
 <Button size="sm" variant="outline" mb="12px" onClick={()=>setRevision(x=>x+1)}>Refresh notifications</Button>
 {error&&<Alert status="error"><AlertIcon/>{error}</Alert>}
 {!data&&!error&&<Text>Loading notifications…</Text>}
 <Stack spacing="12px">{data?.items.map(n=><Box key={n.id} border="1px solid" borderColor={ui.line} borderRadius="6px" p="14px" overflowWrap="anywhere"><Flex gap="8px" wrap="wrap"><Badge>{n.kind}</Badge>{!n.read_at&&<Badge colorScheme="blue">Unread</Badge>}</Flex><Text fontWeight="600" mt="8px">{n.title}</Text><Text mt="6px" fontSize="sm">{n.actor_id} {n.event_type==='release'?'released ownership':n.event_type==='claim'?'claimed the review':`assigned ownership to ${n.owner_id}`} · version {n.assignment_version}</Text><Text fontSize="xs" mt="6px" color={ui.muted}>{new Date(n.created_at).toLocaleString()}</Text><Flex mt="10px" gap="8px" wrap="wrap"><Button as="a" href={notificationLink(n)} size="sm" variant="outline">Open current review</Button>{!n.read_at&&<Button size="sm" variant="ghost" onClick={()=>read(n.id)}>Mark as read</Button>}</Flex></Box>)}</Stack>
 {data&&!data.items.length&&<Text>No notifications on this page.</Text>}
 {data&&<Flex mt="16px" gap="8px" justify="space-between"><Button size="sm" isDisabled={!offset} onClick={()=>{setData(null);setOffset(x=>Math.max(0,x-25));}}>Previous</Button><Text fontSize="sm" alignSelf="center">{data.total} retained</Text><Button size="sm" isDisabled={offset+25>=data.total} onClick={()=>{setData(null);setOffset(x=>x+25);}}>Next</Button></Flex>}
 </ModalBody></ModalContent></Modal></>;
}
