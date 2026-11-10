import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Button, Badge } from './ui';

afterEach(cleanup);

describe('Sky Blue Button', () => {
  it('primary CTA gets the 3D class and the shimmer only when asked', () => {
    render(
      <>
        <Button shimmer>Thành lập</Button>
        <Button>Mua</Button>
        <Button variant="secondary" shimmer>
          Phụ
        </Button>
      </>,
    );
    expect(screen.getByText('Thành lập').className).toContain('btn-primary');
    expect(screen.getByText('Thành lập').className).toContain('btn-shimmer');
    expect(screen.getByText('Mua').className).not.toContain('btn-shimmer');
    // Shimmer is reserved for primary buttons.
    expect(screen.getByText('Phụ').className).not.toContain('btn-shimmer');
  });

  it('loading shows a spinner, sets aria-busy and blocks clicks', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Đặt lệnh
      </Button>,
    );
    const b = screen.getByRole('button');
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.querySelector('.spinner')).not.toBeNull();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to type=button so it never submits forms by accident', () => {
    render(<Button>X</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('badges carry text, not colour alone', () => {
    render(<Badge tone="loss">Quá hạn</Badge>);
    expect(screen.getByText('Quá hạn')).toBeTruthy();
  });
});
