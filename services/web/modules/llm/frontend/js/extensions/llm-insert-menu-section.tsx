// overleaf-lab (owner request 2026-08): the whole-document "AI Generate"
// group (Title / Abstract / Keywords) lives in the INSERT menu, marked with
// the smart_toy icon — upstream-style placement for AI tools.
//
// Core renders this through the `insertMenuSections` overleafModuleImports
// hook (menu-bar.tsx). The group's `title` is a ReactNode (icon + label) —
// the core types were widened for exactly this; plain string titles keep
// rendering exactly as before.
//
// NOTE: the command IDs (llm_generate_*) are registered by
// llm-file-menu-commands (menubarExtraComponents); CommandDropdown drops
// unregistered commands, so this file degrades gracefully without the LLM.
import MaterialIcon from '@/shared/components/material-icon'
import type { MenuSectionStructure } from '@/features/ide-react/components/toolbar/command-dropdown'

const sections: MenuSectionStructure[] = [
    {
        id: 'llm-insert-ai-generate',
        children: [
            {
                id: 'ai-generate-group',
                title: (
                    <span className="llm-menu-ai-title">
                        <MaterialIcon
                            type="smart_toy"
                            style={{ fontSize: 16, marginRight: 6 }}
                        />
                        AI Generate
                    </span>
                ),
                children: ['llm_generate_title', 'llm_generate_abstract', 'llm_generate_keywords']
            }
        ]
    }
]

export default sections
