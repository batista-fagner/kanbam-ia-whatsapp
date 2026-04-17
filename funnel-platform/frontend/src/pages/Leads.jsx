import { Users } from 'lucide-react'

export default function Leads() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-800">Leads</h2>
        <p className="text-sm text-slate-400 mt-0.5">Leads capturados e classificados automaticamente</p>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 font-medium">Nenhum lead ainda</p>
        <p className="text-slate-400 text-sm mt-1">Os leads aparecerão aqui quando o pixel registrar conversões</p>
      </div>
    </div>
  )
}
