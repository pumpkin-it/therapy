import { cn } from '../../lib/utils';

export default function Input({ label, error, className, ...props }) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
      <input
        className={cn(
          'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder-gray-400',
          'focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500',
          error && 'border-red-500',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
