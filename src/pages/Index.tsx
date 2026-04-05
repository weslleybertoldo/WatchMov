import { useState, useMemo } from 'react';
import { useWatchStore } from '@/store/useWatchStore';
import { useAuth } from '@/contexts/AuthContext';
import Dashboard from '@/components/Dashboard';
import SectionList from '@/components/SectionList';
import ItemCard from '@/components/ItemCard';
import ItemDetail from '@/components/ItemDetail';
import AddItemDialog from '@/components/AddItemDialog';
import UpdateChecker from '@/components/UpdateChecker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, LayoutDashboard, Menu, X, LogOut } from 'lucide-react';

export default function Index() {
  const store = useWatchStore();
  const { signOut, user } = useAuth();
  const [view, setView] = useState<'dashboard' | 'section'>('dashboard');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const stats = store.getStats();

  const sectionItems = useMemo(() => {
    if (!activeSection) return [];
    let items = store.data.items.filter(i => i.sectionId === activeSection);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => i.title.toLowerCase().includes(q));
    }
    return items;
  }, [activeSection, store.data.items, searchQuery]);

  const globalSearch = useMemo(() => {
    if (!searchQuery.trim() || view !== 'dashboard') return [];
    const q = searchQuery.toLowerCase();
    return store.data.items.filter(i => i.title.toLowerCase().includes(q));
  }, [searchQuery, store.data.items, view]);

  const selectedItemData = selectedItem ? store.data.items.find(i => i.id === selectedItem) : null;
  const activeSectionData = activeSection ? store.data.sections.find(s => s.id === activeSection) : null;

  const handleSelectSection = (id: string) => {
    setActiveSection(id);
    setView('section');
    setSelectedItem(null);
    setSearchQuery('');
    setSidebarOpen(false);
  };

  const goToDashboard = () => {
    setView('dashboard');
    setActiveSection(null);
    setSelectedItem(null);
    setSearchQuery('');
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-background/80 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-50
        w-64 bg-card border-r border-border p-4 flex flex-col
        transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold text-gradient cursor-pointer" onClick={goToDashboard}>
            🎬 Watch Movies
          </h1>
          <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={() => setSidebarOpen(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <button
          onClick={goToDashboard}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg mb-4 text-sm font-medium transition-all ${
            view === 'dashboard'
              ? 'bg-primary/15 text-foreground glow-border'
              : 'hover:bg-secondary text-muted-foreground hover:text-foreground'
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          Dashboard
        </button>

        <div className="flex-1 overflow-y-auto">
          <SectionList
            sections={store.data.sections}
            activeSection={activeSection}
            onSelect={handleSelectSection}
            onAdd={store.addSection}
            onUpdate={store.updateSection}
            onDelete={store.deleteSection}
          />
        </div>

        <div className="mt-4 pt-4 border-t border-border space-y-3">
          <UpdateChecker />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground truncate max-w-[140px]">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut} className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
              <LogOut className="w-3 h-3 mr-1" />
              Sair
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {/* Top bar */}
        <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-9 w-9 md:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="w-5 h-5" />
            </Button>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar filmes e séries..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 bg-muted/50 border-border h-9"
              />
            </div>
            {view === 'section' && activeSection && !selectedItem && (
              <Button size="sm" onClick={() => setAddDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> Adicionar
              </Button>
            )}
          </div>
        </div>

        <div className="p-4 md:p-6 max-w-4xl mx-auto">
          {/* Dashboard view */}
          {view === 'dashboard' && !selectedItem && (
            <>
              <Dashboard stats={stats} />
              {globalSearch.length > 0 && (
                <div className="mt-6 space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">Resultados da busca</h3>
                  <div className="grid gap-3">
                    {globalSearch.map(item => (
                      <ItemCard key={item.id} item={item} onClick={() => setSelectedItem(item.id)} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Section view - item list */}
          {view === 'section' && !selectedItem && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{activeSectionData?.icon}</span>
                <h2 className="text-2xl font-bold text-foreground">{activeSectionData?.name}</h2>
                <span className="text-sm text-muted-foreground ml-2">({sectionItems.length})</span>
              </div>

              {sectionItems.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <p className="text-lg mb-2">Nenhum item registrado</p>
                  <p className="text-sm">Clique em "Adicionar" para começar!</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {sectionItems.map(item => (
                    <ItemCard key={item.id} item={item} onClick={() => setSelectedItem(item.id)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Item detail view */}
          {selectedItem && selectedItemData && (
            <ItemDetail
              item={selectedItemData}
              onBack={() => setSelectedItem(null)}
              onUpdate={store.updateItem}
              onDelete={store.deleteItem}
              onIncrementEpisode={store.incrementEpisode}
              onDecrementEpisode={store.decrementEpisode}
              onResetSeason={store.resetSeason}
              onResetItem={store.resetItem}
            />
          )}
        </div>
      </main>

      {/* Add Item Dialog */}
      {activeSection && (
        <AddItemDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          sectionId={activeSection}
          onAdd={store.addItem}
        />
      )}
    </div>
  );
}
