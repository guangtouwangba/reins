import { createInterface } from 'node:readline';
import { listSnapshots, saveSnapshot, restoreSnapshot } from '../state/snapshot.js';

export async function runRollback(options: { to?: string }): Promise<void> {
  const projectRoot = process.cwd();
  const snapshots = listSnapshots(projectRoot);

  if (snapshots.length === 0) {
    console.log('No snapshots found. Nothing to roll back to.');
    return;
  }

  let targetId: string;

  if (options.to) {
    // Validate the specified snapshot exists
    const found = snapshots.find(s => s.id === options.to);
    if (!found) {
      console.log(`Snapshot not found: ${options.to}`);
      console.log('Available snapshots:');
      for (const s of snapshots) {
        console.log(`  ${s.id}  (${s.trigger})  ${s.createdAt}`);
      }
      return;
    }
    // Preflight summary
    const target = snapshots.find(s => s.id === options.to)!;
    console.log('');
    console.log('Rollback preview:');
    console.log(`  Snapshot: ${target.id} (${target.trigger}, ${target.createdAt})`);
    console.log(`  Files to restore: ${target.files.length}`);
    for (const f of target.files) {
      console.log(`    ${f.path}`);
    }
    console.log('');

    targetId = options.to;
  } else {
    // Interactive selection
    console.log('Available snapshots (newest first):');
    console.log('');
    snapshots.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.id}  trigger:${s.trigger}  ${s.createdAt}  (${s.files.length} files)`);
    });
    console.log('');

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>(resolve => {
      rl.question('Select snapshot number (or q to quit): ', answer => {
        rl.close();
        resolve(answer.trim());
      });
    });

    if (answer === 'q' || answer === '') {
      console.log('Rollback cancelled.');
      return;
    }

    const idx = parseInt(answer, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= snapshots.length) {
      console.log('Invalid selection.');
      return;
    }

    const selected = snapshots[idx];
    if (!selected) {
      console.log('Invalid selection.');
      return;
    }

    // Show preview
    console.log('');
    console.log('Rollback preview:');
    console.log(`  Snapshot: ${selected.id} (${selected.trigger}, ${selected.createdAt})`);
    console.log(`  Files to restore: ${selected.files.length}`);
    for (const f of selected.files) {
      console.log(`    ${f.path}`);
    }
    console.log('');

    // Confirm
    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    const confirm = await new Promise<string>(resolve => {
      rl2.question('Proceed with rollback? (y/n): ', answer => {
        rl2.close();
        resolve(answer.trim().toLowerCase());
      });
    });

    if (confirm !== 'y') {
      console.log('Rollback cancelled.');
      return;
    }

    targetId = selected.id;
  }

  console.log(`Saving pre-rollback snapshot...`);
  saveSnapshot(projectRoot, 'pre-rollback');

  console.log(`Restoring snapshot: ${targetId}`);
  restoreSnapshot(projectRoot, targetId);

  console.log('');
  console.log(`Rollback complete. Restored to snapshot ${targetId}.`);
  console.log('A pre-rollback snapshot was saved in case you need to undo this.');
}
