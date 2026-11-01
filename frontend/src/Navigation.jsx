import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerHeader, DrawerOverlay, Flex, Link, Stack, Text } from '@chakra-ui/react';
import { activeItem, sections, sectionForView } from './navigation';
import { ui } from './theme';

export default function Navigation({ view, setView }) {
  const [open,setOpen]=useState(false);
  const menuButton=useRef(null);
  const subnav=useRef(null);
  const section=sectionForView(view), selected=activeItem(view);
  useEffect(() => {
    const bar = subnav.current;
    const active = bar?.querySelector('[aria-current="page"]');
    if (!bar || !active) return;
    // Scroll only the submenu, never jump the document or move keyboard focus.
    const reveal = () => {
      bar.scrollLeft = Math.max(0, active.offsetLeft - bar.offsetLeft - 16);
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [selected]);
  const navigate=(event,item)=>{
    if(event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
    event.preventDefault();setOpen(false);setView(item.view);
  };
  return <>
    <Flex as="header" className="app-header" h="52px" bg={ui.nav} color="white" align="center" px={{base:'16px',lg:'24px'}} gap="24px" position="sticky" top="0" zIndex="20">
      <Link href="/" onClick={e=>navigate(e,sections[0].items[0])} aria-label="AISOC home" fontSize="18px" fontWeight="800" fontStyle="italic" letterSpacing="-.06em" _hover={{textDecoration:'none'}} flexShrink="0">AISOC</Link>
      <Flex as="nav" aria-label="Primary navigation" display={{base:'none',lg:'flex'}} align="stretch" h="full" gap="18px" flex="1">
        {sections.map(group=><Link key={group.label} href={group.items[0].path} onClick={e=>navigate(e,group.items[0])} aria-current={group===section?'true':undefined} display="flex" alignItems="center" borderBottom="3px solid" borderColor={group===section?'#a59aff':'transparent'} color={group===section?'white':'#b8bfcd'} fontSize="12px" fontWeight="600" whiteSpace="nowrap" px="2px" _hover={{color:'white',textDecoration:'none'}}>{group.label}</Link>)}
      </Flex>
      <Text display={{base:'block',lg:'none'}} fontSize="12px" color="#c7cad2" flex="1">{section.label}</Text>
      <Text display={{base:'none',xl:'block'}} fontSize="10px" color="#a4acbc" whiteSpace="nowrap">SECURITY OPERATIONS</Text>
      <Button ref={menuButton} display={{base:'inline-flex',lg:'none'}} onClick={()=>setOpen(true)} aria-label="Open navigation" aria-expanded={open} aria-controls="workspace-navigation" variant="unstyled" px="12px" h="34px" border="1px solid #434957" borderRadius="4px" fontSize="12px">☰ Menu</Button>
    </Flex>
    <Flex as="nav" aria-label={`${section.label} navigation`} ref={subnav} className="section-subnav" px={{base:'12px',lg:'24px'}} gap="4px" overflowX="auto" bg="white" borderBottom="1px solid" borderColor={ui.line}>
      {section.items.map(item=><Link key={item.view} href={item.path} onClick={e=>navigate(e,item)} aria-current={selected===item.view?'page':undefined} flexShrink="0" display="flex" alignItems="center" minH="42px" px="12px" borderBottom="2px solid" borderColor={selected===item.view?ui.violet:'transparent'} color={selected===item.view?ui.ink:ui.muted} fontSize="12px" fontWeight={selected===item.view?'700':'500'} _hover={{textDecoration:'none',bg:ui.soft}}>{item.label}</Link>)}
    </Flex>
    <Drawer isOpen={open} placement="left" onClose={()=>setOpen(false)} finalFocusRef={menuButton} size="xs">
      <DrawerOverlay /><DrawerContent id="workspace-navigation"><DrawerCloseButton aria-label="Close navigation" /><DrawerHeader borderBottom="1px solid" borderColor={ui.line}>Workspace navigation</DrawerHeader>
        <DrawerBody px="16px" py="20px"><Stack as="nav" aria-label="Mobile navigation" spacing="20px">
          {sections.map(group=><Box key={group.label}><Text fontSize="10px" textTransform="uppercase" letterSpacing=".08em" color={ui.muted} fontWeight="700" mb="6px">{group.label}</Text><Stack spacing="2px">{group.items.map(item=><Link key={item.view} href={item.path} onClick={e=>navigate(e,item)} aria-current={selected===item.view?'page':undefined} borderLeft="3px solid" borderColor={selected===item.view?ui.violet:'transparent'} bg={selected===item.view?'#eeecff':'transparent'} px="12px" py="10px" borderRadius="3px" fontSize="13px" fontWeight={selected===item.view?'700':'500'} _hover={{textDecoration:'none',bg:ui.soft}}>{item.label}</Link>)}</Stack></Box>)}
        </Stack></DrawerBody>
      </DrawerContent>
    </Drawer>
  </>;
}
