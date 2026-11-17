"use client";

import * as React from "react";
import { cn } from "cn";
import {
  composeRenderProps,
  Input as InputPrimitive,
} from "react-aria-components";

function Input({
  className,
  type,
  ...props
}: React.ComponentProps<typeof InputPrimitive>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={composeRenderProps(className, (className) =>
        cn(
          "h-12 w-full min-w-0 rounded-xl border border-carbon/15 bg-paper/40 px-4 py-3 text-base text-ink transition-[color,background-color,border-color,box-shadow] outline-none file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-carbon placeholder:text-ink-mid/60 focus-visible:border-carbon/50 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-gold/20 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-maroon aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-maroon/10 motion-reduce:transition-none",
          className,
        ),
      )}
      {...props}
    />
  );
}

export { Input };
