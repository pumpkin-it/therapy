import { cn } from '../../lib/utils';

const variants = {
  primary:   'bg-indigo-600 text-white hover:bg-indigo-700',
  secondary: 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50',
  ghost:     'text-gray-600 hover:bg-gray-100',
  danger:    'bg-red-600 text-white hover:bg-red-700',
};
const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
};

export default function Button({ children, variant = 'primary', size = 'md', className, ...props }) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-2 rounded-lg font-medium transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant], sizes[size], className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
