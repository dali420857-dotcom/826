import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createSyntheticDataUiClient } from '../../../src/modules/data';
import { DataWorkItemsPanel } from '../../../src/modules/data/ui/DataWorkItemsPanel';

describe('DataWorkItemsPanel', () => {
  afterEach(() => cleanup());

  it('imports synthetic data, lists a work item and updates its status', async () => {
    render(<DataWorkItemsPanel client={createSyntheticDataUiClient()} />);

    const importButton = await screen.findByRole('button', { name: '導入合成資料' });
    await waitFor(() => expect(importButton).toBeEnabled());
    importButton.click();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getAllByText('待處理').length).toBeGreaterThan(0);
    screen.getAllByRole('button', { name: '標記處理中' })[0]!.click();
    expect(await screen.findByText('處理中')).toBeInTheDocument();
  });

  it('opens a masked work-item detail drawer and returns focus after Escape', async () => {
    render(<DataWorkItemsPanel client={createSyntheticDataUiClient()} />);

    const importButton = await screen.findByRole('button', { name: '導入合成資料' });
    await waitFor(() => expect(importButton).toBeEnabled());
    importButton.click();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    const detailButton = screen.getAllByRole('button', { name: '查看詳情' })[0]!;
    detailButton.focus();
    expect(document.activeElement).toBe(detailButton);
    detailButton.click();

    const drawer = await screen.findByRole('dialog', { name: '工單詳情' });
    expect(drawer).toHaveTextContent('批次 ID');
    expect(drawer).toHaveTextContent('客戶 ID');
    expect(drawer).toHaveTextContent('工單 ID');
    expect(drawer).toHaveTextContent('a***@alpha.example.test');
    expect(drawer).toHaveTextContent('Analytical Engines');
    expect(drawer).toHaveTextContent('Email 狀態');
    expect(drawer).toHaveTextContent('TG 狀態');
    expect(drawer).toHaveTextContent('版本');
    expect(drawer).toHaveTextContent('建立時間');
    expect(drawer).toHaveTextContent('更新時間');
    expect(drawer).not.toHaveTextContent('ada@alpha.example.test');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '工單詳情' })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(detailButton);
  });
});
