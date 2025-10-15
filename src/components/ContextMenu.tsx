import React from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  separator?: boolean;
  children?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [openSubmenuIndex, setOpenSubmenuIndex] = React.useState<number | null>(null);

  React.useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(event.target as Node)) {
        return;
      }

      if (event.button === 0) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-slate-800 border border-slate-600 rounded-lg shadow-2xl py-1 min-w-[200px]"
      style={{ left: `${x}px`, top: `${y}px` }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={`separator-${index}`} className="border-t border-slate-700 my-1" />;
        }

        const hasChildren = item.children && item.children.length > 0;
        const isSubmenuOpen = openSubmenuIndex === index;

        return (
          <div key={`${item.label}-${index}`} className="relative">
            <button
              onClick={(event) => {
                event.stopPropagation();
                if (item.disabled) return;

                if (hasChildren) {
                  setOpenSubmenuIndex(isSubmenuOpen ? null : index);
                } else {
                  item.onClick?.();
                  onClose();
                }
              }}
              disabled={item.disabled}
              className={`w-full px-4 py-2 text-left text-sm flex items-center gap-3 transition-colors ${
                item.disabled
                  ? 'text-slate-500 cursor-not-allowed'
                  : 'text-white hover:bg-slate-700 cursor-pointer'
              }`}
            >
                {item.icon && <span className="text-lg">{item.icon}</span>}
                <span className="flex-1">{item.label}</span>
                {hasChildren && <span className="text-xs">&gt;</span>}
            </button>

            {hasChildren && isSubmenuOpen && (
              <div
                className="absolute left-full top-0 ml-1 bg-slate-800 border border-slate-600 rounded-lg shadow-2xl py-1 min-w-[180px] z-[10000]"
                onClick={(e) => e.stopPropagation()}
              >
                {item.children!.map((child, childIndex) => {
                  if (child.separator) {
                    return <div key={`separator-${childIndex}`} className="border-t border-slate-700 my-1" />;
                  }

                  return (
                    <button
                      key={`${child.label}-${childIndex}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (child.disabled) return;

                        child.onClick?.();
                        onClose();
                      }}
                      disabled={child.disabled}
                      className={`w-full px-4 py-2 text-left text-sm flex items-center gap-3 transition-colors ${
                        child.disabled
                          ? 'text-slate-500 cursor-not-allowed'
                          : 'text-white hover:bg-slate-700 cursor-pointer'
                      }`}
                    >
                      {child.icon && <span className="text-lg">{child.icon}</span>}
                      <span className="flex-1">{child.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ContextMenu;
