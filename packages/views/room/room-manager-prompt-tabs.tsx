"use client";

import {
  ROOM_MANAGER_DEFAULT_CUSTOM_PROMPT,
  ROOM_MANAGER_SYSTEM_PROMPT,
} from "@multica/core/room/manager-prompt";
import { Label } from "@multica/ui/components/ui/label";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Button } from "@multica/ui/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@multica/ui/components/ui/tabs";
import { cn } from "@multica/ui/lib/utils";
import { RotateCcw } from "lucide-react";

const PROMPT_TEXTAREA_CLASS =
  "max-h-56 min-h-36 resize-y text-sm leading-relaxed";

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

export function RoomManagerPromptTabs({ value, onChange, className }: Props) {
  const isModified = value.trim() !== ROOM_MANAGER_DEFAULT_CUSTOM_PROMPT.trim();

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <Label>群管理提示词</Label>
        {isModified ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-6 px-2 text-xs"
            onClick={() => onChange(ROOM_MANAGER_DEFAULT_CUSTOM_PROMPT)}
          >
            <RotateCcw className="mr-1 size-3" />
            重置默认
          </Button>
        ) : null}
      </div>
      <Tabs defaultValue="custom">
        <TabsList className="w-full">
          <TabsTrigger value="custom" className="flex-1">
            定制提示词
          </TabsTrigger>
          <TabsTrigger value="system" className="flex-1">
            系统提示词
          </TabsTrigger>
        </TabsList>
        <TabsContent value="custom" className="mt-2">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={ROOM_MANAGER_DEFAULT_CUSTOM_PROMPT}
            className={PROMPT_TEXTAREA_CLASS}
          />
          <div className="text-muted-foreground mt-1.5 flex items-center justify-between text-xs">
            <span>
              描述本群的工作方式；系统提示词会自动叠加。
            </span>
            <span>{value.length} 字</span>
          </div>
        </TabsContent>
        <TabsContent value="system" className="mt-2">
          <Textarea
            readOnly
            value={ROOM_MANAGER_SYSTEM_PROMPT}
            className={cn(PROMPT_TEXTAREA_CLASS, "bg-muted/40 text-muted-foreground")}
          />
          <p className="text-muted-foreground mt-1.5 text-xs">
            固定能力说明，不可编辑。此内容会与定制提示词合并后发送给群管理 Agent。
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
