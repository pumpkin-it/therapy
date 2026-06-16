import { cn } from '../../lib/utils';

const colors = {
  gray:   'bg-gray-100 text-gray-700',
  blue:   'bg-blue-100 text-blue-800',
  green:  'bg-green-100 text-green-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  red:    'bg-red-100 text-red-800',
  purple: 'bg-purple-100 text-purple-800',
};

export default function Badge({ children, color = 'gray' }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', colors[color])}>
      {children}
    </span>
  );
}
