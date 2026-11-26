import { useCallback, useRef, useState } from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'

export const useLLMChatPane = () => {
    const [isOpen, setIsOpen] = useState(false)
    const [resizing, setResizing] = useState(false)
    const panelRef = useRef<ImperativePanelHandle>(null)

    const togglePane = useCallback(() => {
        setIsOpen(value => !value)
    }, [])

    return {
        isOpen,
        setIsOpen,
        panelRef,
        resizing,
        setResizing,
        togglePane,
    }
}
