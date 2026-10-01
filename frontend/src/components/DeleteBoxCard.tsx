import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteBox } from "@/sdk";
import { useJukebox } from "@/hooks/useJukeboxContext";

const dangerButton = "bg-red-500 text-white hover:bg-red-600";

// Shown only to the user who created the box.
export default function DeleteBoxCard() {
  const { box, user, rows } = useJukebox();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!box?.id || !user?.id || box.user_id !== user.id) return null;
  const boxId = box.id;
  const userId = user.id;

  const handleOpenChange = (next: boolean) => {
    if (isDeleting) return;
    setOpen(next);
    if (next) setError(null);
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await deleteBox(boxId, userId);
      navigate("/");
    } catch (err) {
      console.error("Failed to delete jukebox:", err);
      setError("Couldn't delete this jukebox. Please try again.");
      setIsDeleting(false);
    }
  };

  return (
    <Card className="bg-white text-foreground">
      <CardContent>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">Delete this jukebox</h3>
            <p className="text-sm text-muted-foreground">
              Removes the jukebox, its playlist and the downloaded audio of songs
              no other jukebox uses. This cannot be undone.
            </p>
          </div>
          <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
              <Button className={`${dangerButton} shrink-0 flex items-center gap-1`}>
                <Trash2 className="h-4 w-4" /> Delete jukebox
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete "{box.name}"?</DialogTitle>
                <DialogDescription>
                  {rows.length} {rows.length === 1 ? "song" : "songs"} will be
                  removed from the playlist. Songs that no other jukebox uses are
                  deleted together with their audio files. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              {error && (
                <div className="text-red-600 text-sm p-2 bg-red-50 rounded-md">
                  {error}
                </div>
              )}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="neutral" disabled={isDeleting}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  className={dangerButton}
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting…" : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
