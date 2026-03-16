import Lottie from "lottie-react";
import comingSoonAnimation from "../../assets/animation/coming_soon.json";
import Button from "./ui/button";

interface ComingSoonScreenProps {
  onChangeLocation?: () => void;
}

export default function ComingSoonScreen({ onChangeLocation }: ComingSoonScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="w-48 h-48 sm:w-56 sm:h-56 flex-shrink-0">
          <Lottie animationData={comingSoonAnimation as any} loop={true} />
        </div>
        <h1 className="mt-6 text-xl font-bold text-neutral-900 sm:text-2xl">
          We're coming to your area soon
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Your current location is outside our delivery zones. We're expanding—check back later or try a different address.
        </p>
        {onChangeLocation && (
          <Button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChangeLocation();
            }}
            variant="default"
            className="mt-8 w-full max-w-xs rounded-full bg-green-600 px-6 py-3 font-semibold text-white hover:bg-green-700"
          >
            Change location
          </Button>
        )}
      </div>
    </div>
  );
}
