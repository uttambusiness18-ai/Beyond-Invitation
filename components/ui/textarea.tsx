"use client"

import * as React from "react"
import { cn } from "cn"
import {
  composeRenderProps,
  TextArea as TextareaPrimitive,
} from "react-aria-components"

function Textarea({
  className,
  ...props
}: React.ComponentProps<typeof TextareaPrimitive>) {
  return (
    <TextareaPrimitive
      data-slot="textarea"
      className={composeRenderProps(className, (className) =>
        cn(
          "flex min-h-28 w-full min-w-0 resize-y rounded-xl border border-carbon/15 bg-paper/40 px-4 py-3 text-base text-ink transition-[color,background-color,border-color,box-shadow] outline-none placeholder:text-ink-mid/60 focus-visible:border-carbon/50 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-gold/20 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-maroon aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-maroon/10 motion-reduce:transition-none",
          className
        )
      )}
      {...props}
    />
  )
}

export { Textarea }
