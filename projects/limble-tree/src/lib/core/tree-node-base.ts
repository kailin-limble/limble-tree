import { filter, Observable, Subject, Subscription } from "rxjs";
import { NodeComponent } from "../components/node-component.interface";
import { TreeError } from "../errors";
import { GraftEvent } from "../events/relational/graft-event";
import { PruneEvent } from "../events/relational/prune-event";
import { TreeEvent } from "../structure/tree-event.interface";
import { TreeNode } from "../structure/tree-node.interface";
import { TreePlot } from "../structure/tree-plot";
import { Relationship } from "./relationship.interface";
import { TreeBranch } from "./tree-branch/tree-branch";

export class TreeNodeBase<UserlandComponent>
   implements Partial<TreeNode<TreeBranch<UserlandComponent>, NodeComponent>>
{
   private readonly _branches: Array<TreeBranch<UserlandComponent>>;
   private readonly events$: Subject<TreeEvent>;
   private destroyed: boolean = false;
   private readonly subscriptions: Array<Subscription>;

   public constructor() {
      this._branches = [];
      this.events$ = new Subject();
      this.subscriptions = [
         this.graftsToSelf().subscribe((event) => {
            this.registerChildRelationship(event.child(), event.index());
         }),
         this.prunesToSelf().subscribe((event) => {
            this.deregisterChildRelationship(event.child());
         })
      ];
   }

   public branches(): Array<TreeBranch<UserlandComponent>> {
      return [...this._branches];
   }

   public destroy(): void {
      this.branches().forEach((branch) => {
         branch.destroy();
      });
      this.subscriptions.forEach((sub) => {
         sub.unsubscribe();
      });
      this.destroyed = true;
   }

   public dispatch(event: TreeEvent): void {
      this.events$.next(event);
   }

   public events(): Observable<TreeEvent> {
      return this.events$;
   }

   public getBranch(index: number): TreeBranch<UserlandComponent> | undefined {
      return this._branches[index];
   }

   public isDestroyed(): boolean {
      return this.destroyed;
   }

   public plot(): TreePlot {
      return new Map(
         this.branches().map((branch, index) => [index, branch.plot()])
      );
   }

   public traverse(
      callback: (
         node: TreeNode<TreeBranch<UserlandComponent>, NodeComponent>
      ) => void
   ): void {
      this.branches().forEach((branch) => {
         branch.traverse(callback);
      });
   }

   private deregisterChildRelationship(
      child: TreeBranch<UserlandComponent>
   ): void {
      const index = this.branches().findIndex((branch) => branch === child);
      this._branches.splice(index, 1);
   }

   private graftsToSelf(): Observable<
      GraftEvent<Relationship<UserlandComponent>>
   > {
      return this.events().pipe(
         filter(
            (event): event is GraftEvent<Relationship<UserlandComponent>> =>
               event instanceof GraftEvent
         ),
         filter((event) => event.parent().events() === this.events$)
      );
   }

   private prunesToSelf(): Observable<
      PruneEvent<Relationship<UserlandComponent>>
   > {
      return this.events().pipe(
         filter(
            (event): event is PruneEvent<Relationship<UserlandComponent>> =>
               event instanceof PruneEvent
         ),
         filter((event) => event.parent().events() === this.events$)
      );
   }

   private registerChildRelationship(
      child: TreeBranch<UserlandComponent>,
      index: number
   ): void {
      const branches = this.branches();
      if (index < 0 || index > branches.length) {
         throw new TreeError(
            `Can't register child at index ${index}. Out of range.`
         );
      }
      this._branches.splice(index, 0, child);
   }
}