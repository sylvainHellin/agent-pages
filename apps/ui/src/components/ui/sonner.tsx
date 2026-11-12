import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { useTheme } from "@/lib/theme"

const Toaster = ({ ...props }: ToasterProps) => {
  const mode = useTheme((s) => s.mode)
  return (
    <Sonner
      theme={mode}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !gap-2.5 !rounded-[10px] !px-3.5 !py-3 !text-[13px] !shadow-pop",
          description: "!text-[12.5px] !text-muted-foreground",
          actionButton: "!h-7 !bg-primary !px-2.5 !text-primary-foreground !rounded-md !text-[12.5px] !font-medium",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
