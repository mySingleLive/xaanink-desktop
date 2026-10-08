"use client"
import { useEffect, useState } from "react"
import { useTabsStore, type PanelFocus } from "@/stores/tabs"

/** 请求先消费再更新局部状态；数据/DOM 尚未就绪时由目标面板保留局部请求。 */
export function usePanelFocusRequest(tabId?: string) {
  const [focus, setFocus] = useState<PanelFocus | null>(() => {
    const request = useTabsStore.getState().panelFocus
    return request?.tabId === tabId ? request : null
  })
  useEffect(() => {
    const consume = () => {
      const store = useTabsStore.getState(), request = store.panelFocus
      if (!tabId || request?.tabId !== tabId) return
      store.consumePanelFocus(tabId)
      setFocus(request)
    }
    consume()
    return useTabsStore.subscribe(consume)
  }, [tabId])
  return focus
}
