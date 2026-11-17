"use client"

import { cn } from "cn"
import {
  composeRenderProps,
  RadioGroup as RadioGroupPrimitive,
  Radio as RadioPrimitive,
  type RadioGroupProps,
  type RadioProps,
} from "react-aria-components"

function RadioGroup({ className, ...props }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={composeRenderProps(className, (className) =>
        cn("grid w-full gap-3", className)
      )}
      {...props}
    />
  )
}

function RadioGroupItem({ className, children, ...props }: RadioProps) {
  return (
    <RadioPrimitive
      data-slot="radio-group-item"
      className={composeRenderProps(className, (className) =>
        cn(
          "group/radio-group-item peer relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-carbon/25 text-carbon outline-none transition-[color,background-color,border-color,box-shadow] data-[selected]:border-carbon data-[focus-visible]:border-carbon/50 data-[focus-visible]:ring-2 data-[focus-visible]:ring-gold/40 data-[focus-visible]:ring-offset-2 data-[invalid]:border-maroon data-[invalid]:ring-2 data-[invalid]:ring-maroon/10 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 motion-reduce:transition-none",
          className
        )
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          <span
            data-slot="radio-group-indicator"
            aria-hidden="true"
            className="relative flex h-4 w-4 shrink-0 items-center justify-center"
          >
            {isSelected && (
              <span className="h-2 w-2 rounded-full bg-current" />
            )}
          </span>
          {children}
        </>
      ))}
    </RadioPrimitive>
  )
}

export { RadioGroup, RadioGroupItem }
