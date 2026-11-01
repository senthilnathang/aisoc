import React from "react";
import { Flex } from "@chakra-ui/react";

// Keep each workspace's actions and copy; share hierarchy, spacing and wrapping.
export default function WorkspaceHeader({ children, className = "", ...props }) {
  return <Flex {...props} className={`workspace-header ${className}`}>
    {children}
  </Flex>;
}
